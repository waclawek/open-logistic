import { z } from 'zod'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

export const cargoSchema = z.object({ weightKg: z.number().finite().nonnegative(), palletSpaces: z.number().finite().nonnegative() }).refine((value) => value.weightKg > 0 || value.palletSpaces > 0, { message: 'logistics.dispatcher.errors.invalidCargo' })
const labelSchema = z.string().trim().min(1).max(200)
const dateSchema = z.iso.date()
export const orderStatusSchema = z.enum(['pending', 'confirmed', 'rejected'])
export const order1Schema = z.object({ id: labelSchema, status: orderStatusSchema, cargo: cargoSchema })
export const order2Schema = z.object({
  id: labelSchema, status: orderStatusSchema, carrier: labelSchema,
  vehicle: z.object({ registration: labelSchema, typeKey: labelSchema, capacity: cargoSchema }),
})
export const additionalLoadSchema = z.object({
  id: z.uuid(), offerId: z.uuid(), orderNumber: z.number().int().min(3),
  cargo: cargoSchema, status: z.enum(['confirmed', 'rejected']),
})
const commonFields = {
  reference: labelSchema, customer: labelSchema, origin: labelSchema, destination: labelSchema,
  pickupDate: dateSchema, deliveryDate: dateSchema,
}
export const offerCreateSchema = z.object({
  ...commonFields, cargo: cargoSchema, priceEur: z.number().finite().nonnegative(),
  source: z.enum(['email', 'exchange']), status: z.enum(['new', 'review', 'rejected']).default('new'),
}).refine((value) => value.deliveryDate >= value.pickupDate, { path: ['deliveryDate'], message: 'logistics.dispatcher.errors.invalidDates' })
export const transportCreateSchema = z.object({
  ...commonFields, order1: order1Schema, order2: order2Schema.nullable(),
  additionalLoads: z.array(additionalLoadSchema).max(0).default([]),
}).refine((value) => value.deliveryDate >= value.pickupDate, { path: ['deliveryDate'], message: 'logistics.dispatcher.errors.invalidDates' })
export const offerItemSchema = z.object({
  ...commonFields, id: z.uuid(), updatedAt: z.iso.datetime(), cargo: cargoSchema,
  priceEur: z.number(), source: z.enum(['email', 'exchange']), status: z.enum(['new', 'review', 'accepted', 'rejected']),
})
export const transportItemSchema = z.object({
  ...commonFields, id: z.uuid(), updatedAt: z.iso.datetime(), order1: order1Schema,
  order2: order2Schema.nullable(), additionalLoads: z.array(additionalLoadSchema),
})
export const listQuerySchema = z.object({
  id: z.uuid().optional(), page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50), search: z.string().max(200).optional(),
  available: z.preprocess((value) => value === undefined || typeof value === 'boolean' ? value : parseBooleanToken(typeof value === 'string' ? value : null), z.boolean().optional()),
})
export const deleteSchema = z.object({ id: z.uuid() })
export const transportDecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve_carrier') }),
  z.object({ action: z.literal('reject_carrier') }),
  z.object({ action: z.literal('accept_load'), offerId: z.uuid() }),
])
export const offerDecisionSchema = z.object({ action: z.literal('reject') })
export type StoredOrder1 = z.infer<typeof order1Schema>
export type StoredOrder2 = z.infer<typeof order2Schema>
export type StoredLoad = z.infer<typeof additionalLoadSchema>
export type StoredCargo = z.infer<typeof cargoSchema>
export type TransportDecision = z.infer<typeof transportDecisionSchema>
