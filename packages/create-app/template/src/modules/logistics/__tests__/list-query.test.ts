import { listQuerySchema } from '../data/validators'

test.each([
  ['true', true], ['false', false], [true, true], [false, false],
])('preserves available=%s when the CRUD route parses the query twice', (available, expected) => {
  const parsed = listQuerySchema.parse({ available })
  expect(parsed.available).toBe(expected)
  expect(listQuerySchema.parse(parsed)).toEqual(parsed)
})

test('keeps an omitted availability filter optional after repeated parsing', () => {
  const parsed = listQuerySchema.parse({})
  expect(parsed.available).toBeUndefined()
  expect(listQuerySchema.parse(parsed)).toEqual(parsed)
})

test.each(['invalid', null, 1, {}])('rejects an invalid availability filter: %s', (available) => {
  expect(listQuerySchema.safeParse({ available }).success).toBe(false)
})
