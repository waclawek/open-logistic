import { computeFreeSpace } from '../lib/transports'
import type { TransportFields } from '../types'

jest.mock('@open-mercato/core/modules/sales/data/entities', () => ({ SalesOrder: class {} }))
jest.mock('@open-mercato/core/modules/customers/data/entities', () => ({ CustomerEntity: class {} }))
jest.mock('@open-mercato/core/modules/entities/data/entities', () => ({ CustomFieldValue: class {} }))

const capacity: TransportFields = { vehicle_capacity_pallets: 33, vehicle_capacity_kg: 24000 }
const primary: TransportFields = { cargo_pallets: 18, cargo_weight_kg: 12000 }

test.each([null, -1, Number.NaN, Number.POSITIVE_INFINITY, 'unknown'])('keeps an invalid primary weight %s unknown', (invalid) => {
  expect(computeFreeSpace({ ...primary, cargo_weight_kg: invalid }, capacity, [])).toEqual({ pallets: 15, kg: null, limiting: 'pallets' })
})

test('keeps a missing primary dimension unknown without discarding the known dimension', () => {
  expect(computeFreeSpace({ cargo_weight_kg: 12000 }, capacity, [])).toEqual({ pallets: null, kg: 12000, limiting: 'kg' })
})

test.each([null, -1, Number.NaN, Number.POSITIVE_INFINITY, 'unknown'])('keeps an invalid approved-load weight %s unknown', (invalid) => {
  expect(computeFreeSpace(primary, capacity, [{ cargo_pallets: 4, cargo_weight_kg: invalid }])).toEqual({ pallets: 11, kg: null, limiting: 'pallets' })
})

test('does not silently discard an approved load with a missing pallet dimension', () => {
  expect(computeFreeSpace(primary, capacity, [{ cargo_weight_kg: 2000 }])).toEqual({ pallets: null, kg: 10000, limiting: 'kg' })
})

test('keeps a negative carrier capacity unknown and preserves valid overload information', () => {
  expect(computeFreeSpace(primary, { vehicle_capacity_pallets: -1, vehicle_capacity_kg: 10000 }, [])).toEqual({ pallets: null, kg: -2000, limiting: 'kg' })
})

test('allows a known zero cargo dimension', () => {
  expect(computeFreeSpace({ cargo_pallets: 0, cargo_weight_kg: 1000 }, capacity, [{ cargo_pallets: 0, cargo_weight_kg: 2000 }])).toEqual({ pallets: 33, kg: 21000, limiting: 'kg' })
})
