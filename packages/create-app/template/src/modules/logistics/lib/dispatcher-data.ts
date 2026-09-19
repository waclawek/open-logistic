import type { z } from 'zod'
import type { cargoSchema, order2Schema, orderStatusSchema, offerItemSchema, transportItemSchema } from '../data/validators'

export type Cargo = z.infer<typeof cargoSchema>
export type Vehicle = z.infer<typeof order2Schema>['vehicle']
export type OrderStatus = z.infer<typeof orderStatusSchema>
export type Transport = z.infer<typeof transportItemSchema>
export type Offer = z.infer<typeof offerItemSchema>

export function getRemainingCapacity(transport: Transport): Cargo | null {
  if (!transport.order2) return null
  return transport.additionalLoads.filter((load) => load.status === 'confirmed').reduce(
    (remaining, load) => ({
      weightKg: remaining.weightKg - load.cargo.weightKg,
      palletSpaces: remaining.palletSpaces - load.cargo.palletSpaces,
    }),
    {
      weightKg: transport.order2.vehicle.capacity.weightKg - transport.order1.cargo.weightKg,
      palletSpaces: transport.order2.vehicle.capacity.palletSpaces - transport.order1.cargo.palletSpaces,
    },
  )
}

function isValidCargo(cargo: Cargo): boolean {
  return Number.isFinite(cargo.weightKg) && cargo.weightKg >= 0
    && Number.isFinite(cargo.palletSpaces) && cargo.palletSpaces >= 0
}

export function canAcceptAdditionalLoad(transport: Transport, cargo: Cargo): boolean {
  if (cargo.weightKg === 0 && cargo.palletSpaces === 0) return false
  if (transport.order1.status !== 'confirmed' || transport.order2?.status !== 'confirmed') return false
  if (![cargo, transport.order1.cargo, transport.order2.vehicle.capacity, ...transport.additionalLoads.filter((load) => load.status === 'confirmed').map((load) => load.cargo)].every(isValidCargo)) return false
  const remaining = getRemainingCapacity(transport)
  return remaining !== null && isValidCargo(remaining)
    && cargo.weightKg <= remaining.weightKg && cargo.palletSpaces <= remaining.palletSpaces
}
