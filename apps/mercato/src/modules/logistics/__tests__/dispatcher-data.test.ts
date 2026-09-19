import {
  acceptDemoAdditionalLoad,
  approveDemoCarrier,
  canAcceptAdditionalLoad,
  demoTransports,
  getRemainingCapacity,
  type Cargo,
  type Transport,
} from '../lib/dispatcher-data'

function createTransport(): Transport {
  return {
    id: 'test-transport', customer: 'Customer Demo', origin: 'Warszawa', destination: 'Berlin',
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
      { id: 'extra-1', cargo: { weightKg: 2000, palletSpaces: 3 } },
      { id: 'extra-2', cargo: { weightKg: 3500, palletSpaces: 4 } },
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
    transport.additionalLoads = [{ id: 'invalid', cargo: { weightKg: -500, palletSpaces: 0 } }]
    expect(canAcceptAdditionalLoad(transport, { weightKg: 1, palletSpaces: 1 })).toBe(false)
    transport.additionalLoads = []
    if (!transport.order2) throw new Error('[internal] Missing test Order 2')
    transport.order2.vehicle.capacity.weightKg = Number.POSITIVE_INFINITY
    expect(canAcceptAdditionalLoad(transport, { weightKg: 1, palletSpaces: 1 })).toBe(false)
  })
})

describe('demo actions', () => {
  it('confirms only the chosen existing carrier and does not mutate the source', () => {
    const approved = approveDemoCarrier(demoTransports, 'TR-001')
    expect(approved[0].order2?.status).toBe('confirmed')
    expect(demoTransports[0].order2?.status).toBe('pending')
    expect(approved[1]).toBe(demoTransports[1])
    expect(approveDemoCarrier(approved, 'TR-001')[0]).toBe(approved[0])
    expect(approveDemoCarrier(demoTransports, 'TR-003')[2].order2).toBeNull()
  })

  it('accepts a fitting load once and preserves the original fixture', () => {
    const transport = createTransport()
    const accepted = acceptDemoAdditionalLoad([transport], transport.id)
    expect(accepted[0].additionalLoads).toEqual([
      { id: 'test-transport-additional-demo', cargo: { weightKg: 2000, palletSpaces: 4 } },
    ])
    expect(getRemainingCapacity(accepted[0])).toEqual({ weightKg: 12000, palletSpaces: 9 })
    expect(acceptDemoAdditionalLoad(accepted, transport.id)[0]).toBe(accepted[0])
    expect(transport.additionalLoads).toEqual([])
  })

  it('does not overbook or accept a load without an approved carrier', () => {
    const transport = createTransport()
    transport.order1.cargo.palletSpaces = 30
    expect(acceptDemoAdditionalLoad([transport], transport.id)[0]).toBe(transport)
    expect(acceptDemoAdditionalLoad(demoTransports, 'TR-001')[0]).toBe(demoTransports[0])
    expect(acceptDemoAdditionalLoad(demoTransports, 'TR-003')[2]).toBe(demoTransports[2])
  })
})
