export type Cargo = { weightKg: number; palletSpaces: number }
export type Vehicle = { registration: string; typeKey: string; capacity: Cargo }
export type OrderStatus = 'pending' | 'confirmed'
export type Transport = {
  id: string
  customer: string
  origin: string
  destination: string
  pickupDate: string
  deliveryDate: string
  order1: { id: string; status: OrderStatus; cargo: Cargo }
  order2: { id: string; status: OrderStatus; carrier: string; vehicle: Vehicle } | null
  additionalLoads: Array<{ id: string; cargo: Cargo }>
}
export type Offer = {
  id: string
  customer: string
  origin: string
  destination: string
  pickupDate: string
  deliveryDate: string
  cargo: Cargo
  priceEur: number
  source: 'email' | 'exchange'
  status: 'new' | 'review'
}

export const demoOffers: Offer[] = [
  {
    id: 'OF-001', customer: 'Baltic Paper Demo', origin: 'Gdańsk', destination: 'Berlin',
    pickupDate: '2026-09-21', deliveryDate: '2026-09-22', cargo: { weightKg: 6000, palletSpaces: 10 },
    priceEur: 1200, source: 'email', status: 'new',
  },
  {
    id: 'OF-002', customer: 'Amber Home Demo', origin: 'Poznań', destination: 'Hamburg',
    pickupDate: '2026-09-22', deliveryDate: '2026-09-23', cargo: { weightKg: 2000, palletSpaces: 4 },
    priceEur: 650, source: 'exchange', status: 'new',
  },
  {
    id: 'OF-003', customer: 'Green Parts Demo', origin: 'Wrocław', destination: 'Praha',
    pickupDate: '2026-09-23', deliveryDate: '2026-09-24', cargo: { weightKg: 8500, palletSpaces: 18 },
    priceEur: 950, source: 'email', status: 'review',
  },
]

export const demoTransports: Transport[] = [
  {
    id: 'TR-001', customer: 'North Goods Demo', origin: 'Warszawa', destination: 'Berlin',
    pickupDate: '2026-09-21', deliveryDate: '2026-09-22',
    order1: { id: 'O1-001', status: 'confirmed', cargo: { weightKg: 12000, palletSpaces: 20 } },
    order2: {
      id: 'O2-001', status: 'pending', carrier: 'Blue Road Demo',
      vehicle: { registration: 'DEMO-001', typeKey: 'logistics.dispatcher.vehicle.curtainsider', capacity: { weightKg: 24000, palletSpaces: 33 } },
    },
    additionalLoads: [],
  },
  {
    id: 'TR-002', customer: 'River Packaging Demo', origin: 'Łódź', destination: 'Hamburg',
    pickupDate: '2026-09-22', deliveryDate: '2026-09-23',
    order1: { id: 'O1-002', status: 'confirmed', cargo: { weightKg: 16000, palletSpaces: 24 } },
    order2: {
      id: 'O2-002', status: 'confirmed', carrier: 'Silver Truck Demo',
      vehicle: { registration: 'DEMO-002', typeKey: 'logistics.dispatcher.vehicle.curtainsider', capacity: { weightKg: 24000, palletSpaces: 33 } },
    },
    additionalLoads: [{ id: 'TR-002-additional-001', cargo: { weightKg: 3000, palletSpaces: 5 } }],
  },
  {
    id: 'TR-003', customer: 'Sunny Supply Demo', origin: 'Kraków', destination: 'Wien',
    pickupDate: '2026-09-23', deliveryDate: '2026-09-24',
    order1: { id: 'O1-003', status: 'pending', cargo: { weightKg: 9000, palletSpaces: 16 } },
    order2: null,
    additionalLoads: [],
  },
]

export const demoAdditionalCargo: Cargo = { weightKg: 2000, palletSpaces: 4 }

export function getRemainingCapacity(transport: Transport): Cargo | null {
  if (!transport.order2) return null
  return transport.additionalLoads.reduce(
    (remaining, load) => ({
      weightKg: remaining.weightKg - load.cargo.weightKg,
      palletSpaces: remaining.palletSpaces - load.cargo.palletSpaces,
    }),
    {
      weightKg: transport.order2.vehicle.capacity.weightKg - transport.order1.cargo.weightKg,
      palletSpaces: transport.order2.vehicle.capacity.palletSpaces - transport.order1.cargo.palletSpaces,
    },
  )
}

function isValidCargo(cargo: Cargo): boolean {
  return Number.isFinite(cargo.weightKg) && cargo.weightKg >= 0
    && Number.isFinite(cargo.palletSpaces) && cargo.palletSpaces >= 0
}

export function canAcceptAdditionalLoad(transport: Transport, cargo: Cargo): boolean {
  if (transport.order2?.status !== 'confirmed') return false
  if (![cargo, transport.order1.cargo, transport.order2.vehicle.capacity, ...transport.additionalLoads.map((load) => load.cargo)].every(isValidCargo)) return false
  const remaining = getRemainingCapacity(transport)
  return remaining !== null && isValidCargo(remaining)
    && cargo.weightKg <= remaining.weightKg && cargo.palletSpaces <= remaining.palletSpaces
}

export function approveDemoCarrier(transports: Transport[], id: string): Transport[] {
  return transports.map<Transport>((transport) => transport.id === id && transport.order2?.status === 'pending'
    ? { ...transport, order2: { ...transport.order2, status: 'confirmed' } }
    : transport)
}

export function acceptDemoAdditionalLoad(transports: Transport[], id: string): Transport[] {
  const loadId = `${id}-additional-demo`
  return transports.map((transport) => {
    if (transport.id !== id || transport.additionalLoads.some((load) => load.id === loadId)
      || !canAcceptAdditionalLoad(transport, demoAdditionalCargo)) return transport
    return { ...transport, additionalLoads: [...transport.additionalLoads, { id: loadId, cargo: { ...demoAdditionalCargo } }] }
  })
}
