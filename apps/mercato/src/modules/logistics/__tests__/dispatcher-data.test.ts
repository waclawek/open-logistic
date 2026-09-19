import {
  canAcceptAdditionalLoad,
  getRemainingCapacity,
  type Cargo,
  type Transport,
} from '../lib/dispatcher-data'

function createTransport(): Transport {
  return {
    id: 'test-transport', reference: 'TR-TEST', updatedAt: '2026-09-19T12:00:00.000Z', customer: 'Customer Demo', origin: 'Warszawa', destination: 'Berlin',
    pickupDate: '2026-09-21', deliveryDate: '2026-09-22',
    order1: { id: 'order-1', status: 'confirmed', cargo: { weightKg: 10000, palletSpaces: 20 } },
    order2: {
      id: 'order-2', status: 'confirmed', carrier: 'Carrier Demo',
      vehicle: { registration: 'DEMO-TEST', typeKey: 'test', capacity: { weightKg: 24000, palletSpaces: 33 } },
    },
    additionalLoads: [],
  }
}

describe('remaining vehicle capacity', () => {
  it('subtracts Order 1 and every accepted load independently in kilograms and pallet spaces', () => {
    const transport = createTransport()
    transport.additionalLoads = [
      { id: 'extra-1', offerId: 'offer-1', orderNumber: 3, status: 'confirmed', cargo: { weightKg: 2000, palletSpaces: 3 } },
      { id: 'extra-2', offerId: 'offer-2', orderNumber: 4, status: 'confirmed', cargo: { weightKg: 3500, palletSpaces: 4 } },
    ]
    expect(getRemainingCapacity(transport)).toEqual({ weightKg: 8500, palletSpaces: 6 })
  })

  it('returns unknown capacity when Order 2 is missing', () => {
    expect(getRemainingCapacity({ ...createTransport(), order2: null })).toBeNull()
  })

  it('preserves overload instead of hiding it behind zero', () => {
    const transport = createTransport()
    transport.order1.cargo = { weightKg: 25000, palletSpaces: 34 }
    expect(getRemainingCapacity(transport)).toEqual({ weightKg: -1000, palletSpaces: -1 })
    expect(canAcceptAdditionalLoad(transport, { weightKg: 0, palletSpaces: 0 })).toBe(false)
  })
})

describe('additional load eligibility', () => {
  it.each<[Cargo, boolean]>([
    [{ weightKg: 0, palletSpaces: 0 }, false],
    [{ weightKg: 14000, palletSpaces: 13 }, true],
    [{ weightKg: 14001, palletSpaces: 1 }, false],
    [{ weightKg: 1, palletSpaces: 14 }, false],
    [{ weightKg: -1, palletSpaces: 1 }, false],
    [{ weightKg: 1, palletSpaces: -1 }, false],
    [{ weightKg: Number.NaN, palletSpaces: 1 }, false],
    [{ weightKg: 1, palletSpaces: Number.POSITIVE_INFINITY }, false],
  ])('checks both capacity dimensions for %j', (cargo, expected) => {
    expect(canAcceptAdditionalLoad(createTransport(), cargo)).toBe(expected)
  })

  it('requires a confirmed carrier', () => {
    const transport = createTransport()
    if (!transport.order2) throw new Error('[internal] Missing test Order 2')
    transport.order2.status = 'pending'
    expect(canAcceptAdditionalLoad(transport, { weightKg: 1, palletSpaces: 1 })).toBe(false)
    expect(canAcceptAdditionalLoad({ ...transport, order2: null }, { weightKg: 1, palletSpaces: 1 })).toBe(false)
  })

  it('rejects invalid existing load and capacity data', () => {
    const transport = createTransport()
    transport.additionalLoads = [{ id: 'invalid', offerId: 'offer-3', orderNumber: 3, status: 'confirmed', cargo: { weightKg: -500, palletSpaces: 0 } }]
    expect(canAcceptAdditionalLoad(transport, { weightKg: 1, palletSpaces: 1 })).toBe(false)
    transport.additionalLoads = []
    if (!transport.order2) throw new Error('[internal] Missing test Order 2')
    transport.order2.vehicle.capacity.weightKg = Number.POSITIVE_INFINITY
    expect(canAcceptAdditionalLoad(transport, { weightKg: 1, palletSpaces: 1 })).toBe(false)
  })
})

describe('rejected orders', () => {
  it('does not subtract rejected additional loads', () => {
    const transport = createTransport()
    transport.additionalLoads = [{ id: 'rejected', offerId: 'offer-4', orderNumber: 3, status: 'rejected', cargo: { weightKg: 1000, palletSpaces: 2 } }]
    expect(getRemainingCapacity(transport)).toEqual({ weightKg: 14000, palletSpaces: 13 })
  })

  it('does not accept additional cargo when either order is rejected', () => {
    const transport = createTransport()
    transport.order1.status = 'rejected'
    expect(canAcceptAdditionalLoad(transport, { weightKg: 1, palletSpaces: 1 })).toBe(false)
    transport.order1.status = 'confirmed'
    if (transport.order2) transport.order2.status = 'rejected'
    expect(canAcceptAdditionalLoad(transport, { weightKg: 1, palletSpaces: 1 })).toBe(false)
  })
})
