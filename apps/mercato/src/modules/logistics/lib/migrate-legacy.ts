import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import { LogisticsOffer, LogisticsTransport } from '../data/entities'
import { createLegacyTransport, createOrder } from './sales-orders'
import { withSalesTransaction } from './sales-transaction'
import { guardAllocatedOffer } from './server-offer-guards'
import { nextVersion, logisticsError } from './server-domain'
import type { TransportScope } from './transports'

export function systemCommandContext(container: AwilixContainer, scope: TransportScope): CommandRuntimeContext {
  return { container, auth: null, selectedOrganizationId: scope.organizationId, organizationIds: [scope.organizationId],
    organizationScope: { selectedId: scope.organizationId, filterIds: [scope.organizationId], allowedIds: [scope.organizationId], tenantId: scope.tenantId }, systemActor: true }
}

export async function migrateLegacyTransports(em: EntityManager, container: AwilixContainer, scope: TransportScope, options: { apply?: boolean; channelId?: string } = {}) {
  const legacyRows = await findWithDecryption(em, LogisticsTransport, { ...scope, deletedAt: null }, { orderBy: { id: 'asc' } }, scope)
  const output: Array<{ legacyId: string; reference: string; salesOrderId: string | null; status: 'planned' | 'migrated' | 'existing' }> = []
  for (const source of legacyRows) {
    const existing = await findOneWithDecryption(em, SalesOrder, { ...scope, externalReference: `logistics-legacy:${source.id}` }, {}, scope)
    if (existing || !options.apply) {
      output.push({ legacyId: source.id, reference: source.reference, salesOrderId: existing?.id ?? null, status: existing ? 'existing' : 'planned' })
      continue
    }
    const result = await withSalesTransaction(systemCommandContext(container, scope), async (transaction) => {
      const legacy = await findOneWithDecryption(transaction.em, LogisticsTransport, { ...scope, id: source.id, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }, scope)
      if (!legacy) return logisticsError(404, 'notFound')
      const current = await findOneWithDecryption(transaction.em, SalesOrder, { ...scope, externalReference: `logistics-legacy:${source.id}` }, {}, scope)
      if (current) return { id: current.id, existed: true }
      const offers = await findWithDecryption(transaction.em, LogisticsOffer, { ...scope, allocatedTransportId: legacy.id, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'asc' }, refresh: true }, scope)
      const detail = await createLegacyTransport(transaction, scope, { ...legacy, additionalLoads: [], channelId: options.channelId }, legacy.id)
      const parent = await findOneWithDecryption(transaction.em, SalesOrder, { ...scope, id: detail.order1.id }, {}, scope)
      if (!parent?.channelId) return logisticsError(409, 'salesSetupRequired')
      for (const load of legacy.additionalLoads) {
        const offer = offers.find((entry) => entry.id === load.offerId)
        await createOrder(transaction, scope, {
          name: String(load.orderNumber), customerName: offer?.customer ?? legacy.customer, currencyCode: 'EUR', price: offer?.priceEur ?? 0,
          status: load.status === 'confirmed' ? 'approved' : 'rejected', channelId: parent.channelId,
          fields: { transport_role: 'additional_load', transport_parent_id: parent.id, transport_order_number: load.orderNumber, source_offer_id: load.offerId,
            cargo_pallets: load.cargo.palletSpaces, cargo_weight_kg: load.cargo.weightKg, pickup_address: offer?.origin ?? legacy.origin, delivery_address: offer?.destination ?? legacy.destination,
            client_price: offer?.priceEur ?? 0, exchange_source: 'manual' },
        })
      }
      for (const offer of offers) transaction.afterCommit.push(await guardAllocatedOffer(transaction.ctx, offer, { status: 'accepted', allocatedTransportId: parent.id }))
      for (const offer of offers) {
        offer.allocatedTransportId = parent.id
        offer.updatedAt = nextVersion(offer.updatedAt)
        await emitCrudSideEffects({ dataEngine: transaction.ctx.container.resolve<DataEngine>('dataEngine'), action: 'updated', entity: offer, identifiers: { id: offer.id, ...scope }, indexer: { entityType: 'logistics:logistics_offer' }, events: { module: 'logistics', entity: 'offer', persistent: true } })
      }
      await transaction.em.flush()
      return { id: parent.id, existed: false }
    })
    await container.resolve<DataEngine>('dataEngine').flushOrmEntityChanges()
    output.push({ legacyId: source.id, reference: source.reference, salesOrderId: result.id, status: result.existed ? 'existing' : 'migrated' })
  }
  return output
}
