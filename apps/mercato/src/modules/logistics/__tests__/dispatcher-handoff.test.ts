import {
  agreedOfferFromDispatcherTransport,
  isTransportReadyForDeliveryMonitoring,
  startTransportRunFromDispatcherTransport,
} from '../lib/dispatcher-handoff'
import { clearTransportRuns, getTransportRun } from '../lib/transport-run'
import type { Transport } from '../lib/dispatcher-data'

function sampleTransport(overrides?: Partial<Transport>): Transport {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    reference: 'TR-001',
    customer: 'North Goods Demo',
    origin: 'Warszawa',
    destination: 'Berlin',
    pickupDate: '2026-09-21',
    deliveryDate: '2026-09-22',
    updatedAt: new Date().toISOString(),
    order1: { id: 'O1-001', status: 'confirmed', cargo: { weightKg: 12000, palletSpaces: 20 } },
    order2: {
      id: 'O2-001',
      status: 'confirmed',
      carrier: 'Blue Road Demo',
      vehicle: {
        registration: 'DEMO-001',
        typeKey: 'logistics.dispatcher.vehicle.curtainsider',
        capacity: { weightKg: 24000, palletSpaces: 33 },
      },
    },
    additionalLoads: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        offerId: '33333333-3333-4333-8333-333333333333',
        orderNumber: 3,
        cargo: { weightKg: 2000, palletSpaces: 4 },
        status: 'confirmed',
      },
    ],
    ...overrides,
  }
}

describe('dispatcher → delivery monitoring handoff', () => {
  beforeEach(() => {
    clearTransportRuns()
  })

  it('requires Order 1 + Order 2 confirmed', () => {
    expect(isTransportReadyForDeliveryMonitoring(sampleTransport({ order2: null }))).toBe(false)
    expect(
      isTransportReadyForDeliveryMonitoring(
        sampleTransport({
          order2: {
            id: 'O2',
            status: 'pending',
            carrier: 'X',
            vehicle: {
              registration: 'A',
              typeKey: 't',
              capacity: { weightKg: 24000, palletSpaces: 33 },
            },
          },
        }),
      ),
    ).toBe(false)
    expect(isTransportReadyForDeliveryMonitoring(sampleTransport())).toBe(true)
  })

  it('maps dispatcher transport into agreed offer lane geometry', () => {
    const offer = agreedOfferFromDispatcherTransport(sampleTransport())
    expect(offer.customerReference).toBe('TR-001')
    expect(offer.lane.from.locality).toBe('Warszawa')
    expect(offer.lane.to.locality).toBe('Berlin')
    expect(offer.lane.weightT).toBe(12)
    expect(offer.status).toBe('agreed')
  })

  it('starts an in-transit monitoring run with approved carrier and Order 3 capacity', async () => {
    const transport = sampleTransport()
    const { run, created } = await startTransportRunFromDispatcherTransport(transport)
    expect(created).toBe(true)
    expect(run.sourceTransportId).toBe(transport.id)
    expect(run.status).toBe('in_transit')
    expect(run.approvedCarrier?.party.companyName).toBe('Blue Road Demo')
    expect(run.acceptedBackloads).toHaveLength(1)
    expect(run.truck).not.toBeNull()

    const again = await startTransportRunFromDispatcherTransport(transport)
    expect(again.created).toBe(false)
    expect(again.run.id).toBe(run.id)
    expect(getTransportRun(run.id)?.sourceTransportId).toBe(transport.id)
  })
})
