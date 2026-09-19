import { z } from 'zod'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { enforceCommandOptimisticLockWithGuards, enforceRecordGoneIsConflict } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { LogisticsOffer, LogisticsTransport } from '../data/entities'
import { deleteSchema, offerCreateSchema, offerItemSchema, transportCreateSchema, transportItemSchema, transportDecisionSchema, offerDecisionSchema } from '../data/validators'
import { commandScope } from '../lib/server-scope'
export { commandScope } from '../lib/server-scope'
import { guardAllocatedOffer } from '../lib/server-offer-guards'
import { applyTransportDecision, logisticsError, nextVersion } from '../lib/server-domain'

type RecordEntity = LogisticsOffer | LogisticsTransport
type Kind = 'offer' | 'transport'
type Result = { item: z.infer<typeof offerItemSchema> | z.infer<typeof transportItemSchema>; before?: unknown; relatedBefore?: unknown; relatedAfter?: unknown }

export function serializeOffer(record: LogisticsOffer) {
  return offerItemSchema.parse({ ...record, updatedAt: record.updatedAt.toISOString() })
}

export function serializeTransport(record: LogisticsTransport) {
  return transportItemSchema.parse({ ...record, updatedAt: record.updatedAt.toISOString() })
}

async function lockRecord(em: EntityManager, ctx: CommandRuntimeContext, kind: Kind, id: string) {
  const scope = await commandScope(ctx)
  const record = kind === 'offer'
    ? await findOneWithDecryption(em, LogisticsOffer, { ...scope, id }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }, scope)
    : await findOneWithDecryption(em, LogisticsTransport, { ...scope, id }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }, scope)
  if (!record) {
    enforceRecordGoneIsConflict({ resourceKind: `logistics.${kind}`, resourceId: id, request: ctx.request })
    return logisticsError(404, 'notFound')
  }
  await enforceCommandOptimisticLockWithGuards(ctx.container, { resourceKind: `logistics.${kind}`, resourceId: id, current: record.updatedAt, request: ctx.request })
  return record
}

async function emitChange(ctx: CommandRuntimeContext, record: RecordEntity, kind: Kind, action: 'created' | 'updated' | 'deleted') {
  await emitCrudSideEffects({
    dataEngine: ctx.container.resolve<DataEngine>('dataEngine'), action, entity: record,
    identifiers: { id: record.id, tenantId: record.tenantId, organizationId: record.organizationId },
    actorUserId: ctx.auth?.sub, indexer: { entityType: `logistics:logistics_${kind}` },
    events: { module: 'logistics', entity: kind, persistent: true },
  })
}

function handler(kind: Kind, action: 'create' | 'delete' | 'decide'): CommandHandler<unknown, Result> {
  return {
    id: `logistics.${kind}s.${action}`,
    isUndoable: false,
    async execute(input, ctx) {
      const scope = await commandScope(ctx)
      const em = ctx.container.resolve<EntityManager>('em').fork()
      const afterSuccess: Array<() => Promise<void>> = []
      const changes: Array<{ record: RecordEntity; kind: Kind; action: 'created' | 'updated' | 'deleted' }> = []
      const result = await em.transactional(async (transaction) => {
        if (action === 'create') {
          if (kind === 'offer') {
            const parsed = offerCreateSchema.parse(input)
            const record = transaction.create(LogisticsOffer, { ...parsed, ...scope })
            transaction.persist(record)
            await transaction.flush()
            changes.push({ record, kind, action: 'created' })
            return { item: serializeOffer(record) }
          }
          const { channelId: _channelId, currencyCode: _currencyCode, clientPrice: _clientPrice, maxCarrierCost: _maxCarrierCost, ...parsed } = transportCreateSchema.parse(input)
          const record = transaction.create(LogisticsTransport, { ...parsed, ...scope })
          transaction.persist(record)
          await transaction.flush()
          changes.push({ record, kind, action: 'created' })
          return { item: serializeTransport(record) }
        }
        const { id } = deleteSchema.parse(input)
        const record = await lockRecord(transaction, ctx, kind, id)
        const before = record instanceof LogisticsOffer ? serializeOffer(record) : serializeTransport(record)
        let relatedBefore: unknown
        let relatedAfter: unknown
        if (action === 'delete') {
          if (record instanceof LogisticsOffer && record.allocatedTransportId) return logisticsError(409, 'offerUnavailable')
          if (record instanceof LogisticsTransport) {
            const offers = await findWithDecryption(transaction, LogisticsOffer, { ...scope, allocatedTransportId: id }, { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'asc' }, refresh: true }, scope)
            relatedBefore = offers.map(serializeOffer)
            for (const offer of offers) afterSuccess.push(await guardAllocatedOffer(ctx, offer, { status: 'review', allocatedTransportId: null }))
            for (const offer of offers) {
              offer.allocatedTransportId = null
              offer.status = 'review'
              offer.updatedAt = nextVersion(offer.updatedAt)
              changes.push({ record: offer, kind: 'offer', action: 'updated' })
            }
            relatedAfter = offers.map(serializeOffer)
          }
          record.deletedAt = new Date()
          record.updatedAt = nextVersion(record.updatedAt)
        } else if (record instanceof LogisticsOffer) {
          offerDecisionSchema.parse(input)
          if (record.allocatedTransportId || !['new', 'review'].includes(record.status)) return logisticsError(409, 'offerUnavailable')
          record.status = 'rejected'
          record.updatedAt = nextVersion(record.updatedAt)
        } else {
          const decision = transportDecisionSchema.parse(input)
          let offer: LogisticsOffer | undefined
          if (decision.action === 'accept_load') {
            offer = await findOneWithDecryption(transaction, LogisticsOffer, { ...scope, id: decision.offerId }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }, scope) ?? undefined
            if (!offer) return logisticsError(404, 'notFound')
            relatedBefore = serializeOffer(offer)
            afterSuccess.push(await guardAllocatedOffer(ctx, offer, { status: 'accepted', allocatedTransportId: id }))
          }
          await applyTransportDecision(record, decision, offer)
          if (offer) {
            relatedAfter = serializeOffer(offer)
            changes.push({ record: offer, kind: 'offer', action: 'updated' })
          }
        }
        await transaction.flush()
        changes.push({ record, kind, action: action === 'delete' ? 'deleted' : 'updated' })
        return { item: record instanceof LogisticsOffer ? serializeOffer(record) : serializeTransport(record), before, relatedBefore, relatedAfter }
      })
      for (const callback of afterSuccess) await callback()
      for (const change of changes) await emitChange(ctx, change.record, change.kind, change.action)
      return result
    },
    buildLog({ result, ctx }) {
      return {
        actionLabel: `logistics.${kind}s.${action}`, resourceKind: `logistics.${kind}`, resourceId: result.item.id,
        tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId,
        snapshotBefore: result.before, snapshotAfter: result.item,
        payload: { relatedBefore: result.relatedBefore, relatedAfter: result.relatedAfter },
      }
    },
  }
}

export const dispatcherCommands = (['offer'] as const).flatMap((kind) => (['create', 'delete', 'decide'] as const).map((action) => handler(kind, action)))
for (const command of dispatcherCommands) registerCommand(command)
