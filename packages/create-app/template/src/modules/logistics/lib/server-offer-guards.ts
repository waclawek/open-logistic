import { z } from 'zod'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { bridgeLegacyGuard, runMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { LogisticsOffer } from '../data/entities'
import { logisticsError } from './server-domain'

const logger = createLogger('logistics').child({ component: 'offer-guards' })
const childPayloadSchema = z.object({ status: z.enum(['accepted', 'review']), allocatedTransportId: z.uuid().nullable() })

export async function guardAllocatedOffer(ctx: CommandRuntimeContext, offer: LogisticsOffer, payload: z.infer<typeof childPayloadSchema>): Promise<() => Promise<void>> {
  const headers = new Headers(ctx.request?.headers)
  headers.set(OPTIMISTIC_LOCK_HEADER_NAME, offer.updatedAt.toISOString())
  await enforceCommandOptimisticLockWithGuards(ctx.container, { resourceKind: 'logistics.offer', resourceId: offer.id, current: offer.updatedAt, request: headers })
  const input = { tenantId: offer.tenantId, organizationId: offer.organizationId, userId: ctx.auth?.sub ?? '', resourceKind: 'logistics.offer', resourceId: offer.id, operation: 'update' as const, requestMethod: ctx.request?.method ?? 'POST', requestHeaders: headers, mutationPayload: { id: offer.id, ...payload } }
  const rbac = ctx.container.resolve<{ getGrantedFeatures(userId: string, scope: { tenantId: string; organizationId: string }): Promise<string[]> }>('rbacService')
  const userFeatures = ctx.systemActor ? ['*'] : await rbac.getGrantedFeatures(input.userId, { tenantId: input.tenantId, organizationId: input.organizationId })
  const legacy = bridgeLegacyGuard(ctx.container)
  const result = await runMutationGuards([...getAllMutationGuardInstances(), ...(legacy ? [legacy] : [])], input, { userFeatures })
  if (!result.ok) throw new CrudHttpError(result.errorStatus ?? 422, result.errorBody)
  const modified = childPayloadSchema.parse({ ...payload, ...result.modifiedPayload })
  if (modified.status !== payload.status || modified.allocatedTransportId !== payload.allocatedTransportId) return logisticsError(422, 'invalidInput')
  return async () => {
    for (const callback of result.afterSuccessCallbacks) {
      try {
        await callback.guard.afterSuccess?.({ ...input, metadata: callback.metadata })
      } catch (error) {
        logger.warn('Offer mutation guard afterSuccess callback failed', { error })
        getTelemetryRuntime()?.reportError(error, { module: 'logistics', code: 'logistics.guard_callback_failed' })
      }
    }
  }
}
