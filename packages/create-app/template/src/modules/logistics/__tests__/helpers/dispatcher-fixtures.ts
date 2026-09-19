import type { Cargo, Offer, Transport } from '../../lib/dispatcher-data'

export const demoOffers: Offer[] = [
  {
    id: 'OF-001', reference: 'OF-001', updatedAt: '2026-09-19T12:00:00.000Z', customer: 'Baltic Paper Demo', origin: 'Gdańsk', destination: 'Berlin',
    pickupDate: '2026-09-21', deliveryDate: '2026-09-22', cargo: { weightKg: 6000, palletSpaces: 10 },
    priceEur: 1200, source: 'email', status: 'new',
  },
  {
    id: 'OF-002', reference: 'OF-002', updatedAt: '2026-09-19T12:00:00.000Z', customer: 'Amber Home Demo', origin: 'Poznań', destination: 'Hamburg',
    pickupDate: '2026-09-22', deliveryDate: '2026-09-23', cargo: { weightKg: 2000, palletSpaces: 4 },
    priceEur: 650, source: 'exchange', status: 'new',
  },
  {
    id: 'OF-003', reference: 'OF-003', updatedAt: '2026-09-19T12:00:00.000Z', customer: 'Green Parts Demo', origin: 'Wrocław', destination: 'Praha',
    pickupDate: '2026-09-23', deliveryDate: '2026-09-24', cargo: { weightKg: 8500, palletSpaces: 18 },
    priceEur: 950, source: 'email', status: 'review',
  },
]

export const demoTransports: Transport[] = [
  {
    id: 'TR-001', reference: 'TR-001', updatedAt: '2026-09-19T12:00:00.000Z', customer: 'North Goods Demo', origin: 'Warszawa', destination: 'Berlin',
    pickupDate: '2026-09-21', deliveryDate: '2026-09-22',
    order1: { id: 'O1-001', status: 'confirmed', cargo: { weightKg: 12000, palletSpaces: 20 } },
    order2: {
      id: 'O2-001', status: 'pending', carrier: 'Blue Road Demo',
      vehicle: { registration: 'DEMO-001', typeKey: 'logistics.dispatcher.vehicle.curtainsider', capacity: { weightKg: 24000, palletSpaces: 33 } },
    },
    additionalLoads: [],
  },
  {
    id: 'TR-002', reference: 'TR-002', updatedAt: '2026-09-19T12:00:00.000Z', customer: 'River Packaging Demo', origin: 'Łódź', destination: 'Hamburg',
    pickupDate: '2026-09-22', deliveryDate: '2026-09-23',
    order1: { id: 'O1-002', status: 'confirmed', cargo: { weightKg: 16000, palletSpaces: 24 } },
    order2: {
      id: 'O2-002', status: 'confirmed', carrier: 'Silver Truck Demo',
      vehicle: { registration: 'DEMO-002', typeKey: 'logistics.dispatcher.vehicle.curtainsider', capacity: { weightKg: 24000, palletSpaces: 33 } },
    },
    additionalLoads: [{ id: 'TR-002-additional-001', offerId: 'existing-offer', orderNumber: 3, status: 'confirmed', cargo: { weightKg: 3000, palletSpaces: 5 } }],
  },
  {
    id: 'TR-003', reference: 'TR-003', updatedAt: '2026-09-19T12:00:00.000Z', customer: 'Sunny Supply Demo', origin: 'Kraków', destination: 'Wien',
    pickupDate: '2026-09-23', deliveryDate: '2026-09-24',
    order1: { id: 'O1-003', status: 'pending', cargo: { weightKg: 9000, palletSpaces: 16 } },
    order2: null,
    additionalLoads: [],
  },
]

export const demoAdditionalCargo: Cargo = { weightKg: 2000, palletSpaces: 4 }
