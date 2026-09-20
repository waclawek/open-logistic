import { seedAgreedOffer } from '../lib/agreed-offer'
import {
  clearTransportRuns,
  getTransportRun,
  listTransportRuns,
  startTransportRunFromAgreedOffer,
} from '../lib/transport-run'

jest.mock('../lib/graphhopper', () => ({
  planRoute: jest.fn(),
}))

const scopeA = { tenantId: 'tenant-a', organizationId: 'organization-a' }
const scopeB = { tenantId: 'tenant-b', organizationId: 'organization-b' }

beforeEach(() => {
  clearTransportRuns()
})

afterAll(() => {
  clearTransportRuns()
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
