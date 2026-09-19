import { applyTransportDecision, nextVersion } from '../lib/server-domain'
import { cargoSchema, listQuerySchema, offerCreateSchema, transportCreateSchema } from '../data/validators'
import type { LogisticsOffer, LogisticsTransport } from '../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))

it.each(['true', 'false'])('keeps the available=%s filter valid across repeated query validation', (available) => {
  const parsed = listQuerySchema.parse({ available })
  expect(listQuerySchema.parse(parsed)).toEqual(parsed)
  expect(parsed.available).toBe(available === 'true')
})

function transport(overrides: Partial<LogisticsTransport> = {}): LogisticsTransport {
  return {
    id: '00000000-0000-4000-8000-000000000001', reference: 'TR-TEST', tenantId: 'tenant', organizationId: 'org', customer: 'Customer', origin: 'Origin', destination: 'Destination', pickupDate: '2026-09-21', deliveryDate: '2026-09-22', createdAt: new Date(), updatedAt: new Date('2026-09-19T00:00:00.000Z'), deletedAt: null,
    order1: { id: 'O1', status: 'confirmed', cargo: { weightKg: 10000, palletSpaces: 20 } },
    order2: { id: 'O2', status: 'confirmed', carrier: 'Carrier', vehicle: { registration: 'TEST', typeKey: 'type', capacity: { weightKg: 20000, palletSpaces: 30 } } }, additionalLoads: [], ...overrides,
  }
}
function offer(id = '00000000-0000-4000-8000-000000000002', overrides: Partial<LogisticsOffer> = {}): LogisticsOffer {
  const record = transport()
  return { ...record, id, status: 'new', source: 'email', priceEur: 100, cargo: { weightKg: 4000, palletSpaces: 4 }, allocatedTransportId: null, ...overrides }
}

it('creates sequential Order 3, 4, 5 and includes every confirmed load in capacity', async () => {
  const record = transport()
  for (let index = 0; index < 3; index += 1) {
    const candidate = offer(`00000000-0000-4000-8000-00000000000${index + 2}`, { cargo: { weightKg: 3000, palletSpaces: 3 } })
    await applyTransportDecision(record, { action: 'accept_load', offerId: candidate.id }, candidate)
    expect(candidate.status).toBe('accepted')
    expect(candidate.allocatedTransportId).toBe(record.id)
  }
  expect(record.additionalLoads.map((load) => load.orderNumber)).toEqual([3, 4, 5])
  const tooMuch = offer()
  await expect(applyTransportDecision(record, { action: 'accept_load', offerId: tooMuch.id }, tooMuch)).rejects.toMatchObject({ status: 409, body: { key: 'logistics.dispatcher.errors.insufficientCapacity' } })
  expect(record.additionalLoads).toHaveLength(3)
  expect(tooMuch.status).toBe('new')
})

it.each([{ weightKg: 10001, palletSpaces: 1 }, { weightKg: 1, palletSpaces: 11 }])('blocks excess in either capacity dimension %p', async (cargo) => {
  const record = transport()
  const candidate = offer(undefined, { cargo })
  await expect(applyTransportDecision(record, { action: 'accept_load', offerId: candidate.id }, candidate)).rejects.toMatchObject({ status: 409 })
  expect(record.additionalLoads).toHaveLength(0)
})

it('accepts an exact fit then rejects another load', async () => {
  const record = transport()
  const candidate = offer(undefined, { cargo: { weightKg: 10000, palletSpaces: 10 } })
  await applyTransportDecision(record, { action: 'accept_load', offerId: candidate.id }, candidate)
  await expect(applyTransportDecision(record, { action: 'accept_load', offerId: 'other' }, offer('other'))).rejects.toMatchObject({ status: 409 })
})

it.each(['accepted', 'rejected'] as const)('cannot allocate %s offers', async (status) => {
  const record = transport()
  const candidate = offer(undefined, { status })
  await expect(applyTransportDecision(record, { action: 'accept_load', offerId: candidate.id }, candidate)).rejects.toMatchObject({ status: 409 })
})

it('prevents reusing a previously allocated offer', async () => {
  const candidate = offer()
  await applyTransportDecision(transport(), { action: 'accept_load', offerId: candidate.id }, candidate)
  await expect(applyTransportDecision(transport({ id: 'other' }), { action: 'accept_load', offerId: candidate.id }, candidate)).rejects.toMatchObject({ status: 409 })
})

it.each(['pending', 'rejected'] as const)('requires confirmed carrier, not %s', async (status) => {
  const record = transport()
  record.order2!.status = status
  await expect(applyTransportDecision(record, { action: 'accept_load', offerId: offer().id }, offer())).rejects.toMatchObject({ status: 409 })
})

it('persists rejected carrier decision and does not allow subsequent approval', async () => {
  const record = transport()
  record.order2!.status = 'pending'
  await applyTransportDecision(record, { action: 'reject_carrier' })
  expect(record.order2!.status).toBe('rejected')
  await expect(applyTransportDecision(record, { action: 'approve_carrier' })).rejects.toMatchObject({ status: 409 })
})

it('rejects a zero-size cargo in validation and domain decisions', async () => {
  expect(cargoSchema.safeParse({ weightKg: 0, palletSpaces: 0 }).success).toBe(false)
  expect(cargoSchema.safeParse({ weightKg: 1, palletSpaces: 0 }).success).toBe(true)
  const candidate = offer(undefined, { cargo: { weightKg: 0, palletSpaces: 0 } })
  await expect(applyTransportDecision(transport(), { action: 'accept_load', offerId: candidate.id }, candidate)).rejects.toMatchObject({ status: 400 })
})

it('keeps optimistic versions monotonically increasing inside the same millisecond', () => {
  const future = new Date(Date.now() + 10000)
  expect(nextVersion(future).getTime()).toBe(future.getTime() + 1)
})

it('creation cannot forge an accepted or preallocated offer', () => {
  expect(offerCreateSchema.safeParse(offer(undefined, { status: 'accepted' })).success).toBe(false)
  expect(transportCreateSchema.safeParse({ ...transport(), additionalLoads: [{ id: crypto.randomUUID(), offerId: crypto.randomUUID(), orderNumber: 3, cargo: { weightKg: 1, palletSpaces: 1 }, status: 'confirmed' }] }).success).toBe(false)
})
