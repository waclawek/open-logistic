import type { TransportDetail } from '../types'
import { agreedOfferFromTransport } from '../lib/transport-run-source'

jest.mock('../lib/graphhopper', () => ({
  planRoute: jest.fn(),
}))

function detail(overrides: Partial<TransportDetail['order1']['fields']> = {}): TransportDetail {
  return {
    transportVersion: 'version',
    updatedAt: '2026-09-20T06:00:00.000Z',
    order1: {
      id: '11111111-1111-4111-8111-111111111111',
      orderNumber: 'SO-TRANSPORT-42',
      currencyCode: 'PLN',
      status: 'confirmed',
      customerId: null,
      customerName: 'Morning Demo Customer',
      updatedAt: '2026-09-20T06:00:00.000Z',
      fields: {
        transport_role: 'client',
        pickup_address: 'Magazyn, Warszawa',
        delivery_address: 'Terminal, Poznań',
        pickup_window_start: '2026-09-21T08:00:00.000Z',
        delivery_window_start: '2026-09-21T16:00:00.000Z',
        cargo_weight_kg: 12_500,
        cargo_pallets: 18,
        client_price: 4_200,
        ...overrides,
      },
    },
    order2: null,
    carrierHistory: [],
    additionalLoads: [],
    freeSpace: null,
  }
}

describe('agreedOfferFromTransport', () => {
  test('keeps the random seed shape but overlays the real transport commercial and lane data', () => {
    const offer = agreedOfferFromTransport(detail())

    expect(offer).toMatchObject({
      offerId: 'transport-11111111-1111-4111-8111-111111111111',
      status: 'agreed',
      customerName: 'Morning Demo Customer',
      customerReference: 'SO-TRANSPORT-42',
      currencyCode: 'PLN',
      quoteNetEur: 4_200,
      lane: {
        from: { locality: 'Warszawa', name: 'Magazyn, Warszawa' },
        to: { locality: 'Poznań', name: 'Terminal, Poznań' },
        weightT: 12.5,
        pallets: 18,
      },
    })
    expect(offer.lineItems[0]?.unitPrice).toBe('4200')
    expect(offer.notes).not.toContain('Demo map uses')
  })

  test('retains a valid random demo corridor when saved addresses cannot be geocoded', () => {
    const offer = agreedOfferFromTransport(detail({ pickup_address: 'Unknown A', delivery_address: 'Unknown B' }))

    expect(Number.isFinite(offer.lane.from.lat)).toBe(true)
    expect(Number.isFinite(offer.lane.to.lng)).toBe(true)
    expect(offer.notes).toContain('Demo map uses')
    expect(offer.customerName).toBe('Morning Demo Customer')
    expect(offer.lane.weightT).toBe(12.5)
  })
})
