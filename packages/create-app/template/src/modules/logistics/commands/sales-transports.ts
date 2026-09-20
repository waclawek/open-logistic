import { z } from 'zod'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CRUD_QUERY_INDEX_MANAGED_PAYLOAD_KEY } from '@open-mercato/shared/lib/crud/types'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { buildOptimisticLockConflictBody, readOptimisticLockExpected, enforceCommandOptimisticLockWithGuards, enforceRecordGoneIsConflict } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { LogisticsOffer } from '../data/entities'
import { cargoSchema, transportDecisionSchema, deleteSchema, carrierProposalSchema, additionalLoadProposalSchema } from '../data/validators'
import { commandScope } from '../lib/server-scope'
import { lockLinkedSalesOrders, loadTransportDetail, type TransportScope } from '../lib/transports'
import { executeSales, withSalesTransaction, type SalesTransaction } from '../lib/sales-transaction'
import { channelId, createLegacyTransport, createOrder, requiredStatus } from '../lib/sales-orders'
import { guardAllocatedOffer } from '../lib/server-offer-guards'
import { logisticsError, nextVersion } from '../lib/server-domain'
import type { TransportDetail, TransportOrder } from '../types'

type Result = { item: TransportDetail; before?: TransportDetail; relatedBefore?: unknown; relatedAfter?: unknown }
type SalesAction = 'create' | 'delete' | 'decide' | 'propose_carrier' | 'propose_load' | 'approve_agent_carrier'

async function lockOrder(transaction: SalesTransaction, scope: TransportScope, id: string, expected?: string | null) {
  const order = await findOneWithDecryption(transaction.em, SalesOrder, { ...scope, id, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }, scope)
  if (!order) {
    enforceRecordGoneIsConflict({ resourceKind: 'sales.order', resourceId: id, request: transaction.ctx.request })
    return logisticsError(404, 'notFound')
  }
  if (expected !== null) await enforceCommandOptimisticLockWithGuards(transaction.ctx.container, { resourceKind: 'sales.order', resourceId: id, current: order.updatedAt, request: transaction.ctx.request, ...(expected ? { expected } : {}) })
  return order
}

async function detailFor(em: EntityManager, scope: TransportScope, id: string) {
  const detail = await loadTransportDetail(em, scope, id)
  if (!detail) return logisticsError(404, 'notFound')
  return detail
}

export function nextLoadNumber(detail: TransportDetail): number {
  return Math.max(2, ...detail.additionalLoads.map((order) => typeof order.fields.transport_order_number === 'number' ? order.fields.transport_order_number : 2)) + 1
}

export async function assertLoadFits(detail: TransportDetail, pallets: number, kg: number): Promise<void> {
  if (detail.order1.status !== 'confirmed' || detail.order2?.status !== 'approved') return logisticsError(409, 'carrierNotConfirmed')
  const cargoOrders = [detail.order1, ...detail.additionalLoads.filter((order) => order.status === 'approved')]
  const hasValidCargo = cargoOrders.every((order) => cargoSchema.safeParse({ palletSpaces: order.fields.cargo_pallets, weightKg: order.fields.cargo_weight_kg }).success)
  const hasValidCapacity = cargoSchema.safeParse({ palletSpaces: detail.order2.fields.vehicle_capacity_pallets, weightKg: detail.order2.fields.vehicle_capacity_kg }).success
  if (!hasValidCargo || !hasValidCapacity) return logisticsError(400, 'invalidCargo')
  if (!detail.freeSpace || detail.freeSpace.kg === null || detail.freeSpace.pallets === null || kg > detail.freeSpace.kg || pallets > detail.freeSpace.pallets) return logisticsError(409, 'insufficientCapacity')
}

async function updateStatus(transaction: SalesTransaction, scope: TransportScope, order: TransportOrder, status: string) {
  const locked = await lockOrder(transaction, scope, order.id, order.updatedAt)
  await executeSales(transaction, 'update', { id: order.id, statusEntryId: await requiredStatus(transaction.em, scope, status) }, scope, locked.updatedAt.toISOString())
}

async function touchParent(transaction: SalesTransaction, scope: TransportScope, order: SalesOrder) {
  await executeSales(transaction, 'update', { id: order.id, customFields: { transport_revision: nextVersion(order.updatedAt).toISOString() } }, scope, order.updatedAt.toISOString())
}

async function propose(transaction: SalesTransaction, scope: TransportScope, parent: SalesOrder, detail: TransportDetail, action: 'propose_carrier' | 'propose_load', raw: unknown) {
  const salesChannel = parent.channelId ?? await channelId(transaction.em, scope)
  if (action === 'propose_carrier') {
    const input = carrierProposalSchema.parse(raw)
    if (detail.order2) return logisticsError(409, 'carrierAlreadyProposed')
    await createOrder(transaction, scope, {
      name: detail.order1.orderNumber, customerId: input.carrierCustomerId, customerName: input.carrierName,
      currencyCode: input.currencyCode ?? parent.currencyCode, price: input.carrierCost, status: 'pending_approval', channelId: salesChannel,
      fields: { transport_role: 'carrier', transport_parent_id: parent.id, transport_order_number: 2, vehicle_type: input.vehicleType, vehicle_plate: input.vehiclePlate ?? null,
        vehicle_capacity_pallets: input.vehicleCapacityPallets, vehicle_capacity_kg: input.vehicleCapacityKg, carrier_cost: input.carrierCost,
        exchange_source: input.exchangeSource, exchange_ref: input.exchangeRef ?? null, dispatch_note: input.note ?? null },
    })
  } else {
    const input = additionalLoadProposalSchema.parse(raw)
    await assertLoadFits(detail, input.cargoPallets, input.cargoWeightKg)
    await createOrder(transaction, scope, {
      name: detail.order1.orderNumber, customerId: input.customerId, customerName: input.customerName, currencyCode: input.currencyCode ?? parent.currencyCode,
      price: input.clientPrice, status: 'pending_approval', channelId: salesChannel,
      fields: { transport_role: 'additional_load', transport_parent_id: parent.id, transport_order_number: nextLoadNumber(detail),
        pickup_address: input.pickupAddress, delivery_address: input.deliveryAddress, pickup_window_start: input.pickupWindowStart ?? null, pickup_window_end: input.pickupWindowEnd ?? null,
        cargo_pallets: input.cargoPallets, cargo_weight_kg: input.cargoWeightKg, client_price: input.clientPrice, exchange_source: input.exchangeSource, exchange_ref: input.exchangeRef ?? null, dispatch_note: input.note ?? null },
    })
  }
}

async function approveAgentCarrier(
  transaction: SalesTransaction,
  scope: TransportScope,
  parent: SalesOrder,
  detail: TransportDetail,
  raw: unknown,
) {
  const input = carrierProposalSchema.parse(raw)
  if (detail.order2) {
    const alreadyMapped = detail.order2.status === 'approved'
      && input.exchangeRef
      && detail.order2.fields.exchange_ref === input.exchangeRef
    if (alreadyMapped) return
    return logisticsError(409, 'carrierAlreadyProposed')
  }
  await createOrder(transaction, scope, {
    name: detail.order1.orderNumber,
    customerId: input.carrierCustomerId,
    customerName: input.carrierName,
    currencyCode: input.currencyCode ?? parent.currencyCode,
    price: input.carrierCost,
    status: 'approved',
    channelId: parent.channelId ?? await channelId(transaction.em, scope),
    fields: {
      transport_role: 'carrier',
      transport_parent_id: parent.id,
      transport_order_number: 2,
      vehicle_type: input.vehicleType,
      vehicle_plate: input.vehiclePlate ?? null,
      vehicle_capacity_pallets: input.vehicleCapacityPallets,
      vehicle_capacity_kg: input.vehicleCapacityKg,
      carrier_cost: input.carrierCost,
      exchange_source: input.exchangeSource,
      exchange_ref: input.exchangeRef ?? null,
      dispatch_note: input.note ?? null,
    },
  })
}

async function decide(transaction: SalesTransaction, scope: TransportScope, parent: SalesOrder, detail: TransportDetail, raw: unknown) {
  const decision = transportDecisionSchema.parse(raw)
  if (decision.action === 'approve_carrier' || decision.action === 'reject_carrier') {
    if (!detail.order2 || detail.order2.status !== 'pending_approval') return logisticsError(409, 'carrierNotPending')
    await updateStatus(transaction, scope, detail.order2, decision.action === 'approve_carrier' ? 'approved' : 'rejected')
    return
  }
  if (decision.orderId) {
    const load = detail.additionalLoads.find((order) => order.id === decision.orderId)
    if (!load) return logisticsError(404, 'notFound')
    if (load.status !== 'pending_approval') return logisticsError(409, 'offerUnavailable')
    if (decision.action === 'accept_load') {
      const pallets = load.fields.cargo_pallets
      const kg = load.fields.cargo_weight_kg
      if (typeof pallets !== 'number' || typeof kg !== 'number' || pallets < 0 || kg < 0 || (pallets === 0 && kg === 0)) return logisticsError(400, 'invalidCargo')
      await assertLoadFits(detail, pallets, kg)
    }
    await updateStatus(transaction, scope, load, decision.action === 'accept_load' ? 'approved' : 'rejected')
    return
  }
  if (decision.action !== 'accept_load' || !decision.offerId) return logisticsError(400, 'invalidInput')
  const offer = await findOneWithDecryption(transaction.em, LogisticsOffer, { ...scope, id: decision.offerId, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }, scope)
  if (!offer) return logisticsError(404, 'notFound')
  if (offer.allocatedTransportId || !['new', 'review'].includes(offer.status)) return logisticsError(409, 'offerUnavailable')
  if (!cargoSchema.safeParse(offer.cargo).success) return logisticsError(400, 'invalidCargo')
  await assertLoadFits(detail, offer.cargo.palletSpaces, offer.cargo.weightKg)
  transaction.afterCommit.push(await guardAllocatedOffer(transaction.ctx, offer, { status: 'accepted', allocatedTransportId: parent.id }))
  await createOrder(transaction, scope, {
    name: offer.reference, customerName: offer.customer, currencyCode: 'EUR', price: offer.priceEur, status: 'approved', channelId: parent.channelId ?? await channelId(transaction.em, scope),
    fields: { transport_role: 'additional_load', transport_parent_id: parent.id, transport_order_number: nextLoadNumber(detail), source_offer_id: offer.id,
      pickup_address: offer.origin, delivery_address: offer.destination, pickup_window_start: `${offer.pickupDate}T00:00:00.000Z`, delivery_window_start: `${offer.deliveryDate}T00:00:00.000Z`,
      cargo_pallets: offer.cargo.palletSpaces, cargo_weight_kg: offer.cargo.weightKg, client_price: offer.priceEur, exchange_source: 'manual', exchange_ref: offer.reference },
  })
  offer.status = 'accepted'
  offer.allocatedTransportId = parent.id
  offer.updatedAt = nextVersion(offer.updatedAt)
  await transaction.em.flush()
  await emitCrudSideEffects({ dataEngine: transaction.ctx.container.resolve<DataEngine>('dataEngine'), action: 'updated', entity: offer, identifiers: { id: offer.id, ...scope }, indexer: { entityType: 'logistics:logistics_offer' }, events: { module: 'logistics', entity: 'offer', persistent: true }, actorUserId: transaction.ctx.auth?.sub })
}

async function removeTransport(transaction: SalesTransaction, scope: TransportScope, detail: TransportDetail, linked: SalesOrder[]) {
  const offers = await findWithDecryption(transaction.em, LogisticsOffer, { ...scope, allocatedTransportId: detail.order1.id, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'asc' }, refresh: true }, scope)
  for (const offer of offers) transaction.afterCommit.push(await guardAllocatedOffer(transaction.ctx, offer, { status: 'review', allocatedTransportId: null }))
  for (const order of [...linked.map((record) => ({ id: record.id, updatedAt: record.updatedAt.toISOString() })), detail.order1]) {
    const locked = await lockOrder(transaction, scope, order.id, order.updatedAt)
    await executeSales(transaction, 'delete', { id: order.id }, scope, locked.updatedAt.toISOString())
  }
  for (const offer of offers) {
    offer.status = 'review'
    offer.allocatedTransportId = null
    offer.updatedAt = nextVersion(offer.updatedAt)
    await emitCrudSideEffects({ dataEngine: transaction.ctx.container.resolve<DataEngine>('dataEngine'), action: 'updated', entity: offer, identifiers: { id: offer.id, ...scope }, indexer: { entityType: 'logistics:logistics_offer' }, events: { module: 'logistics', entity: 'offer', persistent: true } })
  }
  await transaction.em.flush()
}

function queueTransportEvent(transaction: SalesTransaction, scope: TransportScope, action: SalesAction, detail: TransportDetail) {
  const identifiers = { id: detail.order1.id, tenantId: scope.tenantId, organizationId: scope.organizationId }
  transaction.afterCommit.push(async () => {
    await transaction.ctx.container.resolve<DataEngine>('dataEngine').emitOrmEntityEvent({
      action: action === 'create' ? 'created' : action === 'delete' ? 'deleted' : 'updated',
      entity: detail, identifiers, actorUserId: transaction.ctx.auth?.sub,
      events: { module: 'logistics', entity: 'transport', persistent: true,
        buildPayload: () => Object.defineProperty({ ...identifiers }, CRUD_QUERY_INDEX_MANAGED_PAYLOAD_KEY, { value: true, enumerable: false }),
      },
    })
  })
}

function handler(action: SalesAction): CommandHandler<unknown, Result> {
  return {
    id: `logistics.transports.${action}`, isUndoable: false,
    async execute(raw, ctx) {
      const scope = await commandScope(ctx)
      return withSalesTransaction(ctx, async (transaction) => {
        if (action === 'create') {
          const item = await createLegacyTransport(transaction, scope, raw)
          queueTransportEvent(transaction, scope, action, item)
          return { item }
        }
        const { id, transportVersion } = deleteSchema.parse(raw)
        const parent = await lockOrder(transaction, scope, id, null)
        const linked = await lockLinkedSalesOrders(transaction.em, scope, id)
        const before = await detailFor(transaction.em, scope, id)
        await enforceCommandOptimisticLockWithGuards(transaction.ctx.container, { resourceKind: 'logistics.transport', resourceId: id, current: before.updatedAt, request: transaction.ctx.request })
        if (transportVersion && transportVersion !== before.transportVersion) throw new CrudHttpError(409, buildOptimisticLockConflictBody(before.updatedAt, readOptimisticLockExpected(transaction.ctx.request) ?? before.updatedAt))
        if (action === 'delete') {
          await removeTransport(transaction, scope, before, linked)
          queueTransportEvent(transaction, scope, action, before)
          return { item: before, before }
        }
        if (action === 'decide') await decide(transaction, scope, parent, before, raw)
        else if (action === 'approve_agent_carrier') await approveAgentCarrier(transaction, scope, parent, before, raw)
        else await propose(transaction, scope, parent, before, action, raw)
        await touchParent(transaction, scope, parent)
        transaction.em.clear()
        const item = await detailFor(transaction.em, scope, id)
        queueTransportEvent(transaction, scope, action, item)
        return { item, before }
      })
    },
    buildLog({ result, ctx }) {
      return { actionLabel: `logistics.transports.${action}`, resourceKind: 'sales.order', resourceId: result.item.order1.id,
        tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId, snapshotBefore: result.before, snapshotAfter: result.item }
    },
  }
}

export const salesTransportCommands = (['create', 'delete', 'decide', 'propose_carrier', 'propose_load', 'approve_agent_carrier'] as const).map(handler)
for (const command of salesTransportCommands) registerCommand(command)

registerCommand({
  id: 'logistics.transports.migrate', isUndoable: false,
  async execute(raw: unknown, ctx: CommandRuntimeContext) {
    if (!ctx.systemActor || ctx.auth) return logisticsError(403, 'unauthorized')
    const scope = await commandScope(ctx)
    const input = z.object({ channelId: z.uuid().optional(), dryRun: z.boolean().default(false) }).parse(raw)
    const { migrateLegacyTransports } = await import('../lib/migrate-legacy')
    return migrateLegacyTransports(ctx.container.resolve<EntityManager>('em'), ctx.container, scope, { apply: !input.dryRun, channelId: input.channelId })
  },
  buildLog({ result, ctx }) {
    return { actionLabel: 'logistics.transports.migrate', resourceKind: 'sales.order', tenantId: ctx.organizationScope?.tenantId, organizationId: ctx.selectedOrganizationId, payload: { migrated: result } }
  },
})
