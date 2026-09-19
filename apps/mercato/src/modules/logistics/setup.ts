import { randomUUID } from 'node:crypto'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { LogisticsOffer, LogisticsTransport } from './data/entities'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: { admin: ['logistics.view', 'logistics.manage'] },
  async seedExamples({ em: rootEm, tenantId, organizationId }) {
    await rootEm.transactional(async (em) => {
    const scope = { tenantId, organizationId }
    const existing = await findOneWithDecryption(em, LogisticsTransport, { ...scope, reference: 'TR-001' }, {}, scope)
    if (existing) return
    const offerData = [
      { reference: 'OF-001', customer: 'Baltic Paper Demo', origin: 'Gdańsk', destination: 'Berlin', pickupDate: '2026-09-21', deliveryDate: '2026-09-22', cargo: { weightKg: 6000, palletSpaces: 10 }, priceEur: 1200, source: 'email' as const, status: 'new' as const },
      { reference: 'OF-002', customer: 'Amber Home Demo', origin: 'Poznań', destination: 'Hamburg', pickupDate: '2026-09-22', deliveryDate: '2026-09-23', cargo: { weightKg: 2000, palletSpaces: 4 }, priceEur: 650, source: 'exchange' as const, status: 'new' as const },
      { reference: 'OF-003', customer: 'Green Parts Demo', origin: 'Wrocław', destination: 'Praha', pickupDate: '2026-09-23', deliveryDate: '2026-09-24', cargo: { weightKg: 8500, palletSpaces: 18 }, priceEur: 950, source: 'email' as const, status: 'review' as const },
      { reference: 'OF-004', customer: 'Extra Parts Demo', origin: 'Poznań', destination: 'Berlin', pickupDate: '2026-09-21', deliveryDate: '2026-09-22', cargo: { weightKg: 1000, palletSpaces: 2 }, priceEur: 300, source: 'email' as const, status: 'new' as const },
    ]
    for (const offer of offerData) em.persist(em.create(LogisticsOffer, { ...scope, ...offer }))
    const transportData = [
      { reference: 'TR-001', customer: 'North Goods Demo', origin: 'Warszawa', destination: 'Berlin', pickupDate: '2026-09-21', deliveryDate: '2026-09-22', order1: { id: 'O1-001', status: 'confirmed' as const, cargo: { weightKg: 12000, palletSpaces: 20 } }, order2: { id: 'O2-001', status: 'pending' as const, carrier: 'Blue Road Demo', vehicle: { registration: 'DEMO-001', typeKey: 'logistics.dispatcher.vehicle.curtainsider', capacity: { weightKg: 24000, palletSpaces: 33 } } } },
      { reference: 'TR-002', customer: 'River Packaging Demo', origin: 'Łódź', destination: 'Hamburg', pickupDate: '2026-09-22', deliveryDate: '2026-09-23', order1: { id: 'O1-002', status: 'confirmed' as const, cargo: { weightKg: 16000, palletSpaces: 24 } }, order2: { id: 'O2-002', status: 'confirmed' as const, carrier: 'Silver Truck Demo', vehicle: { registration: 'DEMO-002', typeKey: 'logistics.dispatcher.vehicle.curtainsider', capacity: { weightKg: 24000, palletSpaces: 33 } } } },
      { reference: 'TR-003', customer: 'Sunny Supply Demo', origin: 'Kraków', destination: 'Wien', pickupDate: '2026-09-23', deliveryDate: '2026-09-24', order1: { id: 'O1-003', status: 'pending' as const, cargo: { weightKg: 9000, palletSpaces: 16 } }, order2: null },
    ]
    const transports = transportData.map((transport) => em.create(LogisticsTransport, { ...scope, ...transport, additionalLoads: [] }))
    transports.forEach((transport) => em.persist(transport))
    await em.flush()
    const allocated = em.create(LogisticsOffer, { ...scope, reference: 'OF-005', customer: 'River Extra Demo', origin: 'Łódź', destination: 'Hamburg', pickupDate: '2026-09-22', deliveryDate: '2026-09-23', cargo: { weightKg: 3000, palletSpaces: 5 }, priceEur: 700, source: 'email', status: 'accepted', allocatedTransportId: transports[1].id })
    em.persist(allocated)
    await em.flush()
    transports[1].additionalLoads = [{ id: randomUUID(), offerId: allocated.id, orderNumber: 3, cargo: allocated.cargo, status: 'confirmed' }]
    await em.flush()
    })
  },
}

export default setup
