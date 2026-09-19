import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { reportError } from '@open-mercato/telemetry'
import { CommandReceipt, CommandResultRecord, DriverProfile, TransportJob, VehicleProfile } from '../data/entities'
import { commandActionSchema, commandResultSchema, type CommandRecord, type CommandResult } from '../data/commandValidators'
import { uuidSchema } from '../data/validators'
import { digestCommandInput } from '../lib/commandInput'
import { authorizeLogisticsCommand, type LogisticsCommandContext } from './context'

type Mutation = {
  records: () => CommandRecord[]
  afterCommit?: () => Promise<void>
}

type ReceiptOptions = {
  ctx: CommandRuntimeContext
  requiredFeatures: string[]
  action: string
  requestId: string
}

async function loadReceiptResult(em: EntityManager, context: LogisticsCommandContext, receipt: CommandReceipt): Promise<CommandResult> {
  const rows = await findWithDecryption(em, CommandResultRecord, { ...context.scope, receiptId: receipt.id }, { orderBy: { sequence: 'asc' } }, context.scope)
  return commandResultSchema.parse({
    requestId: receipt.requestId,
    action: receipt.action,
    records: rows.map((row) => ({
      entityType: row.entityType, id: row.recordId, updatedAt: row.recordUpdatedAt.toISOString(),
      ...(row.planRevision === null ? {} : { planRevision: row.planRevision }),
      ...(row.factRevision === null ? {} : { factRevision: row.factRevision }),
      ...(row.ledgerRevision === null ? {} : { ledgerRevision: row.ledgerRevision }),
    })),
  })
}

export async function readCommandReceipt(options: ReceiptOptions): Promise<CommandResult | null> {
  const action = commandActionSchema.parse(options.action)
  const requestId = uuidSchema.parse(options.requestId)
  const context = await authorizeLogisticsCommand(options.ctx, options.requiredFeatures)
  const em = options.ctx.container.resolve<EntityManager>('em').fork()
  const receipt = await findOneWithDecryption(em, CommandReceipt, {
    ...context.scope, actorUserId: context.actorUserId, action, requestId,
  }, undefined, context.scope)
  return receipt ? loadReceiptResult(em, context, receipt) : null
}

export async function runReceiptedCommand(options: ReceiptOptions & {
  input: unknown
  mutate: (em: EntityManager, context: LogisticsCommandContext) => Promise<Mutation>
}): Promise<CommandResult> {
  const action = commandActionSchema.parse(options.action)
  const requestId = uuidSchema.parse(options.requestId)
  const context = await authorizeLogisticsCommand(options.ctx, options.requiredFeatures)
  const rootEm = options.ctx.container.resolve<EntityManager>('em')
  if (options.ctx.transactionalEm || rootEm.isInTransaction()) return context.fail(409, 'nestedCommand')
  const em = rootEm.fork()
  const inputDigest = digestCommandInput(options.input)
  const key = { ...context.scope, actorUserId: context.actorUserId, action, requestId }
  let result: CommandResult | undefined
  let mutation: Mutation | undefined
  await withAtomicFlush(em, [
    async () => {
      await em.getConnection().execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [JSON.stringify(key)], 'all', em.getTransactionContext())
      const existing = await findOneWithDecryption(em, CommandReceipt, key, undefined, context.scope)
      if (existing) {
        if (existing.inputDigest !== inputDigest) return context.fail(409, 'requestIdReused')
        result = await loadReceiptResult(em, context, existing)
        return
      }
      mutation = await options.mutate(em, context)
    },
    async () => {
      if (!mutation) return
      result = commandResultSchema.parse({ action, requestId, records: mutation.records() })
      const now = new Date()
      const receipt = em.create(CommandReceipt, { id: randomUUID(), ...key, inputDigest, committedAt: now, createdAt: now, updatedAt: now })
      em.persist(receipt)
      result.records.forEach((record, sequence) => {
        em.persist(em.create(CommandResultRecord, {
          ...context.scope, receiptId: receipt.id, sequence, entityType: record.entityType, recordId: record.id,
          recordUpdatedAt: new Date(record.updatedAt), planRevision: record.planRevision ?? null,
          factRevision: record.factRevision ?? null, ledgerRevision: record.ledgerRevision ?? null,
          createdAt: now, updatedAt: now,
        }))
      })
    },
  ], { transaction: true, label: action })
  if (!result) throw new Error('[internal] Logistics command committed without a result')
  if (mutation?.afterCommit) {
    try { await mutation.afterCommit() } catch {
      reportError(new Error('[internal] Logistics postcommit effects failed'), { module: 'logistics', code: 'logistics.postcommit_failed', attributes: { action, requestId } })
    }
  }
  return result
}

export async function lockDispatchRecords(em: EntityManager, context: LogisticsCommandContext, ids: {
  driverProfileIds?: string[]
  vehicleProfileIds?: string[]
  jobIds?: string[]
}) {
  const lock = async <Entity extends DriverProfile | VehicleProfile | TransportJob>(entity: new () => Entity, requested: string[] = []): Promise<Entity[]> => {
    const records: Entity[] = []
    for (const id of [...new Set(requested)].sort()) {
      uuidSchema.parse(id)
      const record = await findOneWithDecryption(em, entity, { ...context.scope, id, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }, context.scope)
      if (!record) return context.fail(404, 'notFound')
      records.push(record)
    }
    return records
  }
  const drivers = await lock(DriverProfile, ids.driverProfileIds)
  const vehicles = await lock(VehicleProfile, ids.vehicleProfileIds)
  const jobs = await lock(TransportJob, ids.jobIds)
  return { drivers, vehicles, jobs }
}
