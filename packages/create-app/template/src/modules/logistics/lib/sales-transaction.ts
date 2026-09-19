import { asValue, type AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { bridgeLegacyGuard, runMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { logisticsError } from './server-domain'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('logistics').child({ component: 'sales-transaction' })

type DeferredChange = Parameters<DataEngine['markOrmEntityChange']>[0]
type DeferredCommandContext = CommandRuntimeContext & { deferredSideEffects?: Array<() => Promise<void>> }
export type SalesTransaction = { em: EntityManager; ctx: DeferredCommandContext; afterCommit: Array<() => Promise<void>> }

export async function withSalesTransaction<Result>(ctx: CommandRuntimeContext, run: (transaction: SalesTransaction) => Promise<Result>): Promise<Result> {
  const rootEm = ctx.container.resolve<EntityManager>('em').fork()
  const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')
  let transactionActive = true
  const changes: DeferredChange[] = []
  const afterCommit: Array<() => Promise<void>> = []
  const scopes: AwilixContainer[] = []
  try {
  const result = await rootEm.transactional(async (em) => {
    const container = ctx.container.createScope()
    scopes.push(container)
    const boundEm = new Proxy(em, {
      get(target, key) {
        if (key === 'fork') return (options: Parameters<EntityManager['fork']>[0] = {}) => transactionActive ? target.fork({ ...options, keepTransactionContext: true }) : rootEm.fork({ ...options, keepTransactionContext: false })
        const effective = transactionActive ? target : rootEm
        const value: unknown = Reflect.get(effective, key, effective)
        return typeof value === 'function' ? value.bind(effective) : value
      },
    })
    const deferredEngine = new Proxy(dataEngine, {
      get(target, key) {
        if (key === 'markOrmEntityChange') return (change: DeferredChange) => { if (transactionActive) changes.push(change); else target.markOrmEntityChange(change) }
        if (key === 'flushOrmEntityChanges') return async () => { if (!transactionActive) await target.flushOrmEntityChanges() }
        const value: unknown = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    container.register({ em: asValue(boundEm), dataEngine: asValue(deferredEngine) })
    return run({ em, ctx: { ...ctx, container, transactionalEm: em, deferredSideEffects: afterCommit }, afterCommit })
  })
  transactionActive = false
  for (const change of changes) dataEngine.markOrmEntityChange(change)
  for (const callback of afterCommit) {
    try { await callback() }
    catch (error) {
      logger.warn('Post-commit side effect failed', { error })
      getTelemetryRuntime()?.reportError(error, { module: 'logistics', code: 'logistics.post_commit_effect_failed' })
    }
  }
  return result
  } finally { for (const scope of scopes) await scope.dispose() }
}

export async function executeSales<Result>(transaction: SalesTransaction, action: 'create' | 'update' | 'delete', input: Record<string, unknown>, scope: { tenantId: string; organizationId: string }, updatedAt?: string): Promise<Result> {
  const headers = new Headers(transaction.ctx.request?.headers)
  headers.delete(OPTIMISTIC_LOCK_HEADER_NAME)
  if (updatedAt) headers.set(OPTIMISTIC_LOCK_HEADER_NAME, updatedAt)
  const ctx = { ...transaction.ctx, request: new Request(transaction.ctx.request?.url ?? 'http://localhost/internal/logistics', { method: 'POST', headers }) }
  const guardInput = { ...scope, userId: ctx.auth?.sub ?? '', resourceKind: 'sales.order', resourceId: typeof input.id === 'string' ? input.id : null,
    operation: action, requestMethod: 'POST', requestHeaders: headers, mutationPayload: input }
  const rbac = ctx.container.resolve<{ getGrantedFeatures(userId: string, scope: { tenantId: string; organizationId: string }): Promise<string[]> }>('rbacService')
  const userFeatures = ctx.systemActor ? ['*'] : await rbac.getGrantedFeatures(guardInput.userId, scope)
  const legacy = bridgeLegacyGuard(ctx.container)
  const guards = await runMutationGuards([...getAllMutationGuardInstances(), ...(legacy ? [legacy] : [])], guardInput, { userFeatures })
  if (!guards.ok) throw new CrudHttpError(guards.errorStatus ?? 422, guards.errorBody)
  if (guards.modifiedPayload && Object.entries(guards.modifiedPayload).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(input[key]))) return logisticsError(422, 'invalidInput')
  const bus = ctx.container.resolve<CommandBus>('commandBus')
  const payload = { ...input, ...guards.modifiedPayload, ...scope }
  const { result } = await bus.execute<unknown, Result>(`sales.orders.${action}`, { input: payload, ctx, metadata: { skipLog: true } })
  for (const callback of guards.afterSuccessCallbacks) transaction.afterCommit.push(async () => { await callback.guard.afterSuccess?.({ ...guardInput, resourceId: guardInput.resourceId ?? (typeof result === 'object' && result !== null && 'orderId' in result ? String(result.orderId) : ''), metadata: callback.metadata }) })
  return result
}
