import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { resolveStatusEntryIdByValue } from '@open-mercato/core/modules/sales/lib/statusHelpers'
import { transportCreateSchema } from '../data/validators'
import { loadTransportDetail, type TransportScope } from './transports'
import { executeSales, type SalesTransaction } from './sales-transaction'
import { logisticsError } from './server-domain'
import type { TransportDetail, TransportFields } from '../types'

export async function requiredStatus(em: EntityManager, scope: TransportScope, value: string): Promise<string> {
  const id = await resolveStatusEntryIdByValue(em, { ...scope, value })
  if (!id) return logisticsError(409, 'salesSetupRequired')
  return id
}

export async function channelId(em: EntityManager, scope: TransportScope, requested?: string): Promise<string> {
  const channel = await findOneWithDecryption(em, SalesChannel, { ...scope, deletedAt: null, isActive: true, ...(requested ? { id: requested } : {}) }, { orderBy: { createdAt: 'asc' } }, scope)
  if (!channel) return logisticsError(409, 'salesSetupRequired')
  return channel.id
}

async function customer(em: EntityManager, scope: TransportScope, id: string | undefined, name: string | undefined) {
  if (!id) return { customerSnapshot: { customer: { displayName: name ?? '' } } }
  const record = await findOneWithDecryption(em, CustomerEntity, { ...scope, id, deletedAt: null }, {}, scope)
  if (!record) return logisticsError(404, 'notFound')
  return { customerEntityId: id }
}

export async function createOrder(transaction: SalesTransaction, scope: TransportScope, input: {
  name: string; customerId?: string; customerName?: string; currencyCode: string; price: number; status: string; channelId: string; fields: TransportFields; reference?: string; externalReference?: string
}) {
  const identity = await customer(transaction.em, scope, input.customerId, input.customerName)
  const { translate } = await import('@open-mercato/shared/lib/i18n/server').then((module) => module.resolveTranslations())
  const result = await executeSales<{ orderId: string }>(transaction, 'create', {
    ...identity, currencyCode: input.currencyCode, channelId: input.channelId,
    statusEntryId: await requiredStatus(transaction.em, scope, input.status),
    ...(input.reference ? { orderNumber: input.reference } : {}),
    ...(input.externalReference ? { externalReference: input.externalReference } : {}),
    lines: [{ currencyCode: input.currencyCode, kind: 'service', name: translate('logistics.sales.service'), quantity: 1, unitPriceNet: input.price }],
    customFields: input.fields,
  }, scope)
  return result.orderId
}

export async function createLegacyTransport(transaction: SalesTransaction, scope: TransportScope, raw: unknown, legacyId?: string): Promise<TransportDetail> {
  const input = transportCreateSchema.parse(raw)
  const salesChannel = await channelId(transaction.em, scope, input.channelId)
  const id = await createOrder(transaction, scope, {
    name: input.reference, reference: input.reference, externalReference: legacyId ? `logistics-legacy:${legacyId}` : undefined, customerName: input.customer, currencyCode: input.currencyCode, price: input.clientPrice,
    status: input.order1.status === 'confirmed' ? 'confirmed' : input.order1.status === 'rejected' ? 'rejected' : 'pending_approval', channelId: salesChannel,
    fields: { legacy_transport_id: legacyId ?? null, transport_role: 'client', transport_order_number: 1, pickup_address: input.origin, delivery_address: input.destination,
      pickup_window_start: `${input.pickupDate}T00:00:00.000Z`, pickup_window_end: `${input.pickupDate}T23:59:59.000Z`, delivery_window_start: `${input.deliveryDate}T00:00:00.000Z`,
      cargo_pallets: input.order1.cargo.palletSpaces, cargo_weight_kg: input.order1.cargo.weightKg, client_price: input.clientPrice, max_carrier_cost: input.maxCarrierCost ?? null, exchange_source: 'manual' },
  })
  if (input.order2) await createOrder(transaction, scope, {
    name: input.order2.id, customerName: input.order2.carrier, currencyCode: input.currencyCode, price: 0,
    status: input.order2.status === 'confirmed' ? 'approved' : input.order2.status === 'rejected' ? 'rejected' : 'pending_approval', channelId: salesChannel,
    fields: { transport_role: 'carrier', transport_parent_id: id, transport_order_number: 2, vehicle_type: input.order2.vehicle.typeKey, vehicle_plate: input.order2.vehicle.registration,
      vehicle_capacity_pallets: input.order2.vehicle.capacity.palletSpaces, vehicle_capacity_kg: input.order2.vehicle.capacity.weightKg, carrier_cost: 0, exchange_source: 'manual' },
  })
  const detail = await loadTransportDetail(transaction.em, scope, id)
  if (!detail) return logisticsError(404, 'notFound')
  return detail
}
