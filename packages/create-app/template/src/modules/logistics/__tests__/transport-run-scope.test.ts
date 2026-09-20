import { seedAgreedOffer } from '../lib/agreed-offer'
import {
  approveCarrierProposal,
  clearTransportRuns,
  getTransportRun,
  listTransportRuns,
  startTransportRunFromAgreedOffer,
} from '../lib/transport-run'
import { clearOrders, getOrder } from '../lib/orders-store'

jest.mock('../lib/graphhopper', () => ({
  planRoute: jest.fn(),
}))

const scopeA = { tenantId: 'tenant-a', organizationId: 'organization-a' }
const scopeB = { tenantId: 'tenant-b', organizationId: 'organization-b' }

beforeEach(() => {
  clearTransportRuns()
  clearOrders()
})

afterAll(() => {
  clearTransportRuns()
  clearOrders()
})

test('transport runs are tenant and organization scoped', async () => {
  const run = await startTransportRunFromAgreedOffer({
    offer: seedAgreedOffer(),
    withOrder: false,
    scope: scopeA,
    sourceTransportId: 'transport-1',
  })

  expect(listTransportRuns(20, scopeA)).toEqual([run])
  expect(listTransportRuns(20, scopeB)).toEqual([])
  expect(getTransportRun(run.id, scopeA)).toBe(run)
  expect(getTransportRun(run.id, scopeB)).toBeNull()
})

test('the same source transport starts only one run inside its scope', async () => {
  const offer = seedAgreedOffer()
  const first = await startTransportRunFromAgreedOffer({
    offer,
    withOrder: false,
    scope: scopeA,
    sourceTransportId: 'transport-1',
  })
  const replay = await startTransportRunFromAgreedOffer({
    offer: seedAgreedOffer(),
    withOrder: false,
    scope: scopeA,
    sourceTransportId: 'transport-1',
  })
  const otherScope = await startTransportRunFromAgreedOffer({
    offer: seedAgreedOffer(),
    withOrder: false,
    scope: scopeB,
    sourceTransportId: 'transport-1',
  })

  expect(replay.id).toBe(first.id)
  expect(otherScope.id).not.toBe(first.id)
  expect(listTransportRuns(20, scopeA)).toHaveLength(1)
  expect(listTransportRuns(20, scopeB)).toHaveLength(1)
})

test('carrier approval applies the selected vehicle capacity before backload search', async () => {
  const run = await startTransportRunFromAgreedOffer({
    offer: seedAgreedOffer({ lane: { ...seedAgreedOffer().lane, weightT: 6.2, ldm: 5 } }),
    scope: scopeA,
    sourceTransportId: 'transport-1',
  })
  run.status = 'carrier_proposal_pending'
  run.carrierProposal = {
    id: 'proposal-1',
    source: 'active_vehicle_search',
    provider: 'trans',
    summary: 'Selected 18 tonne vehicle',
    rationale: 'The nearest vehicle that fits the agreed client load.',
    priceEur: 900,
    party: {
      companyName: 'Carrier',
      contactName: 'Dispatch',
      phone: '+48 000 000 000',
      email: 'dispatch@example.com',
      addressLine: 'Test 1',
      postalCode: '00-001',
      city: 'Poznań',
      country: 'PL',
      nip: '0000000000',
    },
    vehicle: {
      id: 'vehicle-18t',
      provider: 'trans',
      locality: 'Poznań',
      country: 'PL',
      lat: 52.4,
      lng: 16.9,
      radiusKm: 50,
      vehicleType: 'BOX',
      capacityT: 18,
      availableFrom: run.createdAt,
      remark: 'Available',
    },
    createdAt: run.createdAt,
  }

  approveCarrierProposal(run.id)

  expect(getOrder(run.orderId!)?.capacity).toMatchObject({
    maxWeightT: 18,
    usedWeightT: 6.2,
    freeWeightT: 11.8,
  })
})
