import { parseScaledDecimal, formatScaledDecimal } from '../lib/decimal'
import { factActionSchema, jobCreateSchema, jobUpdateSchema, vehicleProfileInputSchema, weightSchema } from '../data/validators'

const recordId = 'a3248df0-12ba-4710-8e2d-94af2142a59e'
const place = { label: 'Depot', addressLine: '1 Test Street', city: 'Warsaw', countryCode: 'PL', timezone: 'Europe/Warsaw' }
const job = {
  requestId: recordId, customerId: recordId, cargoDescription: 'Pallets', weightKg: '200.001',
  isPalletized: true, pallets: 2, pickupPlace: place, deliveryPlace: place,
  pickupWindowStart: '2026-09-21T08:00:00Z', pickupWindowEnd: '2026-09-21T09:00:00Z',
  deliveryWindowStart: '2026-09-21T10:00:00Z', deliveryWindowEnd: '2026-09-21T12:00:00Z',
}

describe('Logistics input boundaries', () => {
  test('accepts complete unassigned work without any vehicle or driver', () => {
    expect(jobCreateSchema.parse(job).weightKg).toBe('200.001')
  })
  test.each(['tenantId', 'organizationId', 'actorUserId', 'status', 'customerNameSnapshot'])('rejects client-controlled %s', (field) => {
    expect(jobCreateSchema.safeParse({ ...job, [field]: recordId }).success).toBe(false)
  })
  test.each([
    { isPalletized: true, pallets: null }, { isPalletized: true, pallets: 0 },
    { isPalletized: false, pallets: 2 }, { isPalletized: true, pallets: undefined },
  ])('requires explicit consistent pallet classification: %j', (cargo) => {
    expect(jobCreateSchema.safeParse({ ...job, ...cargo }).success).toBe(false)
  })
  test('nonpallet cargo explicitly has no pallet count', () => {
    expect(jobCreateSchema.safeParse({ ...job, isPalletized: false, pallets: null }).success).toBe(true)
  })
  test.each(['0', '-1', '1.0001', '1e3', 'NaN', '1000000000', '01', '0.000'])('rejects invalid weight %s', (weight) => {
    expect(weightSchema.safeParse(weight).success).toBe(false)
  })
  test('rejects reversed and impossible promise windows', () => {
    expect(jobCreateSchema.safeParse({ ...job, pickupWindowEnd: '2026-09-21T07:00:00Z' }).success).toBe(false)
    expect(jobCreateSchema.safeParse({ ...job, deliveryWindowStart: '2026-09-20T10:00:00Z', deliveryWindowEnd: '2026-09-20T12:00:00Z' }).success).toBe(false)
  })
  test('rejects impossible dates and unqualified local timestamps', () => {
    expect(jobCreateSchema.safeParse({ ...job, pickupWindowStart: '2026-02-30T08:00:00Z' }).success).toBe(false)
    expect(jobCreateSchema.safeParse({ ...job, pickupWindowStart: '2026-10-25T02:30:00' }).success).toBe(false)
    expect(jobCreateSchema.safeParse({ ...job, pickupPlace: { ...place, timezone: 'Invalid/Zone' } }).success).toBe(false)
  })
  test('requires valid versions for edits and fact actions', () => {
    expect(jobUpdateSchema.safeParse({ ...job, id: recordId }).success).toBe(false)
    expect(jobUpdateSchema.safeParse({ ...job, id: recordId, expectedUpdatedAt: 'invalid' }).success).toBe(false)
    expect(jobUpdateSchema.safeParse({ ...job, id: recordId, expectedUpdatedAt: '2026-09-19T12:00:00Z' }).success).toBe(true)
    const action = { id: recordId, requestId: recordId, expectedUpdatedAt: '2026-09-19T12:00:00Z' }
    expect(factActionSchema.safeParse(action).success).toBe(false)
    expect(factActionSchema.safeParse({ ...action, expectedFactRevision: -1 }).success).toBe(false)
    expect(factActionSchema.safeParse({ ...action, expectedFactRevision: 0 }).success).toBe(true)
  })
  test('requires a complete manual last-known observation and normalizes registration', () => {
    const profile = { resourceId: recordId, registration: ' wa 123 ', maxPayloadKg: '1000', maxPallets: null, dispatchEnabled: true, lastKnownPlace: null, lastKnownAt: null, lastKnownSource: null }
    expect(vehicleProfileInputSchema.parse(profile).registration).toBe('WA123')
    expect(vehicleProfileInputSchema.safeParse({ ...profile, lastKnownPlace: place }).success).toBe(false)
    expect(vehicleProfileInputSchema.safeParse({ ...profile, lastKnownPlace: place, lastKnownAt: '2026-09-19T12:00:00Z', lastKnownSource: 'manual_confirmation' }).success).toBe(true)
    expect(vehicleProfileInputSchema.safeParse({ ...profile, ledgerRevision: 100 }).success).toBe(false)
  })
})

describe('Exact decimal arithmetic', () => {
  test('preserves fractional units through arithmetic and large values', () => {
    expect(formatScaledDecimal(parseScaledDecimal('0.1', 1) + parseScaledDecimal('0.2', 1), 1)).toBe('0.3')
    expect(formatScaledDecimal(parseScaledDecimal('999999999.999', 3), 3)).toBe('999999999.999')
    expect(formatScaledDecimal(-1n, 3)).toBe('-0.001')
    expect(formatScaledDecimal(0n, 0)).toBe('0')
  })
  test.each(['1e3', '01.0', '-0.1', '0.01', '1.', '.1', 'Infinity'])('does not round or coerce malformed odometers %s', (value) => {
    expect(() => parseScaledDecimal(value, 1)).toThrow(RangeError)
  })
})
