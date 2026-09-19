import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { dispatcherCollection } from '../api/collection'

jest.mock('@open-mercato/shared/lib/crud/factory', () => ({ makeCrudRoute: jest.fn(() => ({})) }))
jest.mock('../data/entities', () => ({ LogisticsOffer: class LogisticsOffer {}, LogisticsTransport: class LogisticsTransport {} }))

test.each(['2026-09-19 15:30:00.123+00', '2026-09-19T17:30:00.123+02:00', new Date('2026-09-19T15:30:00.123Z')])('normalizes database timestamp %s before validating the response version', (version) => {
  dispatcherCollection('offer')
  const transform = jest.mocked(makeCrudRoute).mock.calls.at(-1)![0].list!.transformItem!
  const item = transform({
    id: '00000000-0000-4000-8000-000000000001', reference: 'OF-TEST', customer: 'Customer',
    origin: 'Warszawa', destination: 'Berlin', pickup_date: '2026-09-21', delivery_date: '2026-09-22',
    updated_at: version, cargo: { weightKg: 100, palletSpaces: 1 }, price_eur: 100, source: 'email', status: 'new',
  })
  expect(item).toMatchObject({ updatedAt: '2026-09-19T15:30:00.123Z' })
})
