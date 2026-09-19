import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesOrder, SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import { installCustomEntitiesFromModules } from '@open-mercato/core/modules/entities/lib/install-from-ce'
import { LogisticsOffer, LogisticsTransport } from '../data/entities'
import { LOGISTICS_ENTITY_IDS } from '../ce'
import { systemCommandContext } from './migrate-legacy'
import type { TransportScope } from './transports'

export async function seedLogisticsExamples(em: EntityManager, container: AwilixContainer, scope: TransportScope): Promise<void> {
  await installCustomEntitiesFromModules(em, null, { entityIds: [...LOGISTICS_ENTITY_IDS], tenantIds: [scope.tenantId], includeGlobal: false })
  const bus = container.resolve<CommandBus>('commandBus')
  const ctx = systemCommandContext(container, scope)
  let channel = await findOneWithDecryption(em, SalesChannel, { ...scope, isActive: true, deletedAt: null }, {}, scope)
  if (!channel) {
    await bus.execute('sales.channels.create', { input: { ...scope, name: 'Logistics demo', code: 'logistics-demo', isActive: true }, ctx })
    channel = await findOneWithDecryption(em, SalesChannel, { ...scope, code: 'logistics-demo', deletedAt: null }, {}, scope)
  }
    const offerData = [
      { reference: 'OF-001', customer: 'Baltic Paper Demo', origin: 'Gdańsk', destination: 'Berlin', pickupDate: '2026-09-21', deliveryDate: '2026-09-22', cargo: { weightKg: 6000, palletSpaces: 10 }, priceEur: 1200, source: 'email' as const, status: 'new' as const },
      { reference: 'OF-002', customer: 'Amber Home Demo', origin: 'Poznań', destination: 'Hamburg', pickupDate: '2026-09-22', deliveryDate: '2026-09-23', cargo: { weightKg: 2000, palletSpaces: 4 }, priceEur: 650, source: 'exchange' as const, status: 'new' as const },
      { reference: 'OF-003', customer: 'Green Parts Demo', origin: 'Wrocław', destination: 'Praha', pickupDate: '2026-09-23', deliveryDate: '2026-09-24', cargo: { weightKg: 8500, palletSpaces: 18 }, priceEur: 950, source: 'email' as const, status: 'review' as const },
      { reference: 'OF-004', customer: 'Extra Parts Demo', origin: 'Poznań', destination: 'Berlin', pickupDate: '2026-09-21', deliveryDate: '2026-09-22', cargo: { weightKg: 1000, palletSpaces: 2 }, priceEur: 300, source: 'email' as const, status: 'new' as const },
    ]
    const transportData = [
      { reference: 'TR-001', customer: 'North Goods Demo', origin: 'Warszawa', destination: 'Berlin', pickupDate: '2026-09-21', deliveryDate: '2026-09-22', order1: { id: 'O1-001', status: 'confirmed' as const, cargo: { weightKg: 12000, palletSpaces: 20 } }, order2: { id: 'O2-001', status: 'pending' as const, carrier: 'Blue Road Demo', vehicle: { registration: 'DEMO-001', typeKey: 'logistics.dispatcher.vehicle.curtainsider', capacity: { weightKg: 24000, palletSpaces: 33 } } } },
      { reference: 'TR-002', customer: 'River Packaging Demo', origin: 'Łódź', destination: 'Hamburg', pickupDate: '2026-09-22', deliveryDate: '2026-09-23', order1: { id: 'O1-002', status: 'confirmed' as const, cargo: { weightKg: 16000, palletSpaces: 24 } }, order2: { id: 'O2-002', status: 'confirmed' as const, carrier: 'Silver Truck Demo', vehicle: { registration: 'DEMO-002', typeKey: 'logistics.dispatcher.vehicle.curtainsider', capacity: { weightKg: 24000, palletSpaces: 33 } } } },
      { reference: 'TR-003', customer: 'Sunny Supply Demo', origin: 'Kraków', destination: 'Wien', pickupDate: '2026-09-23', deliveryDate: '2026-09-24', order1: { id: 'O1-003', status: 'pending' as const, cargo: { weightKg: 9000, palletSpaces: 16 } }, order2: null },
    ]

  for (const input of transportData) {
    if (await findOneWithDecryption(em, LogisticsTransport, { ...scope, reference: input.reference, deletedAt: null }, {}, scope)) continue
    if (await findOneWithDecryption(em, SalesOrder, { ...scope, orderNumber: input.reference, deletedAt: null }, {}, scope)) continue
    await bus.execute('logistics.transports.create', { input: { ...input, channelId: channel?.id }, ctx })
  }
  for (const input of offerData) {
    if (await findOneWithDecryption(em, LogisticsOffer, { ...scope, reference: input.reference, deletedAt: null }, {}, scope)) continue
    await bus.execute('logistics.offers.create', { input, ctx })
  }

  if (await findOneWithDecryption(em, LogisticsTransport, { ...scope, reference: 'TR-002', deletedAt: null }, {}, scope)) return
  const transport = await findOneWithDecryption(em, SalesOrder, { ...scope, orderNumber: 'TR-002', deletedAt: null }, {}, scope)
  if (!transport) return
  let allocatedOffer = await findOneWithDecryption(em, LogisticsOffer, { ...scope, reference: 'OF-005', deletedAt: null }, {}, scope)
  if (!allocatedOffer) {
    await bus.execute('logistics.offers.create', { input: { reference: 'OF-005', customer: 'River Extra Demo', origin: 'Łódź', destination: 'Hamburg', pickupDate: '2026-09-22', deliveryDate: '2026-09-23', cargo: { weightKg: 3000, palletSpaces: 5 }, priceEur: 700, source: 'email', status: 'new' }, ctx })
    allocatedOffer = await findOneWithDecryption(em, LogisticsOffer, { ...scope, reference: 'OF-005', deletedAt: null }, {}, scope)
  }
  if (allocatedOffer && !allocatedOffer.allocatedTransportId && ['new', 'review'].includes(allocatedOffer.status)) {
    await bus.execute('logistics.transports.decide', { input: { id: transport.id, action: 'accept_load', offerId: allocatedOffer.id }, ctx })
  }
}
