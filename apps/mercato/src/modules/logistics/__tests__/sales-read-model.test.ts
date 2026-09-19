import { computeFreeSpace } from '../lib/transports'
import { carrierProposalSchema, additionalLoadProposalSchema, transportDecisionSchema } from '../data/validators'

jest.mock('@open-mercato/core/modules/sales/data/entities', () => ({ SalesOrder: class {} }))
jest.mock('@open-mercato/core/modules/customers/data/entities', () => ({ CustomerEntity: class {} }))
jest.mock('@open-mercato/core/modules/entities/data/entities', () => ({ CustomFieldValue: class {} }))

test('free space subtracts every approved load from both dimensions', () => {
  expect(computeFreeSpace({ cargo_pallets: 18, cargo_weight_kg: 12000 }, { vehicle_capacity_pallets: 33, vehicle_capacity_kg: 24000 }, [{ cargo_pallets: 4, cargo_weight_kg: 2000 }, { cargo_pallets: 2, cargo_weight_kg: 1500 }])).toEqual({ pallets: 9, kg: 8500, limiting: 'pallets' })
})
test('capacity retains overload and unknown dimensions', () => {
  expect(computeFreeSpace({ cargo_pallets: 18, cargo_weight_kg: 12000 }, { vehicle_capacity_kg: 10000 }, [])).toEqual({ pallets: null, kg: -2000, limiting: 'kg' })
  expect(computeFreeSpace({}, null, [])).toBeNull()
})
test('accepting a load requires exactly one scoped offer or Sales order identifier', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  expect(transportDecisionSchema.safeParse({ action: 'accept_load' }).success).toBe(false)
  expect(transportDecisionSchema.safeParse({ action: 'accept_load', orderId: id, offerId: id }).success).toBe(false)
  expect(transportDecisionSchema.safeParse({ action: 'accept_load', orderId: id }).success).toBe(true)
  expect(transportDecisionSchema.safeParse({ action: 'reject_load', orderId: id }).success).toBe(true)
})
test('proposals reject negative capacity and missing customer identity', () => {
  expect(carrierProposalSchema.safeParse({ carrierName: 'Carrier', carrierCost: 10, vehicleType: 'FTL', vehicleCapacityPallets: -1, vehicleCapacityKg: 100 }).success).toBe(false)
  expect(additionalLoadProposalSchema.safeParse({ pickupAddress: 'A', deliveryAddress: 'B', cargoPallets: 1, cargoWeightKg: 2, clientPrice: 10 }).success).toBe(false)
})
