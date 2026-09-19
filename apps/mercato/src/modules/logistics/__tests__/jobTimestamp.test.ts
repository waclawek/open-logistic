import { jobTimestampValue } from '../lib/jobTimestamp'

it.each([
  ['2026-09-19 14:52:24.637+00', '2026-09-19T14:52:24.637Z'],
  ['2026-09-19 16:52:24.637+02', '2026-09-19T14:52:24.637Z'],
  ['2026-09-19T14:52:24.637Z', '2026-09-19T14:52:24.637Z'],
  [new Date('2026-09-19T14:52:24.637Z'), '2026-09-19T14:52:24.637Z'],
])('normalizes a persisted version %p to the UTC command contract', (input, expected) => {
  expect(jobTimestampValue('updatedAt', input)).toBe(expected)
})

it.each(['pickupWindowStart', 'pickupWindowEnd', 'deliveryWindowStart', 'deliveryWindowEnd', 'acceptedAt', 'firstAssignedAt', 'terminalAt', 'createdAt', 'updatedAt'])('normalizes %s and preserves absent values', field => {
  expect(jobTimestampValue(field, '2026-10-01 08:00:00+00')).toBe('2026-10-01T08:00:00.000Z')
  expect(jobTimestampValue(field, null)).toBeNull()
})

it.each(['invalid', '2026-10-01 08:00:00', 42, undefined])('rejects invalid/zoneless stored timestamps %p', value => {
  expect(() => jobTimestampValue('updatedAt', value)).toThrow()
})

it('preserves ordinary strings and structured cargo fields', () => {
  const place = { label: '2026-10-01 08:00:00+00' }
  expect(jobTimestampValue('cargoDescription', '2026-10-01 08:00:00+00')).toBe('2026-10-01 08:00:00+00')
  expect(jobTimestampValue('pickupPlace', place)).toBe(place)
})
