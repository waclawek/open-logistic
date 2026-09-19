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
  ...commonFields, channelId: z.uuid().optional(), currencyCode: z.string().regex(/^[A-Z]{3}$/).default('EUR'), clientPrice: z.number().finite().nonnegative().default(0), maxCarrierCost: z.number().finite().nonnegative().optional(), order1: order1Schema, order2: order2Schema.nullable(),
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
  available: z.preprocess((value) => value === undefined ? undefined : parseBooleanToken(typeof value === 'string' ? value : null), z.boolean().optional()),
})
export const transportVersionSchema = z.string().regex(/^[a-f0-9]{64}$/).optional()
export const deleteSchema = z.object({ id: z.uuid(), transportVersion: transportVersionSchema })
const transportDecisionActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve_carrier') }),
  z.object({ action: z.literal('reject_carrier') }),
  z.object({ action: z.literal('accept_load'), offerId: z.uuid().optional(), orderId: z.uuid().optional() }).refine((input) => Boolean(input.offerId) !== Boolean(input.orderId), { message: 'logistics.dispatcher.errors.invalidInput' }),
  z.object({ action: z.literal('reject_load'), orderId: z.uuid() }),
])
export const transportDecisionSchema = transportDecisionActionSchema.and(z.object({ transportVersion: transportVersionSchema }))
export const offerDecisionSchema = z.object({ action: z.literal('reject') })
export type StoredOrder1 = z.infer<typeof order1Schema>
export type StoredOrder2 = z.infer<typeof order2Schema>
export type StoredLoad = z.infer<typeof additionalLoadSchema>
export type StoredCargo = z.infer<typeof cargoSchema>
export type TransportDecision = z.infer<typeof transportDecisionSchema>

export const carrierProposalSchema = z.object({ transportVersion: transportVersionSchema, carrierCustomerId: z.uuid().optional(), carrierName: labelSchema.optional(), carrierCost: z.number().finite().nonnegative(), vehicleType: labelSchema, vehicleCapacityPallets: z.number().finite().nonnegative(), vehicleCapacityKg: z.number().finite().nonnegative(), vehiclePlate: labelSchema.optional(), currencyCode: z.string().regex(/^[A-Z]{3}$/).optional(), exchangeSource: z.enum(['manual', 'seed', 'trans', 'timocom']).default('manual'), exchangeRef: labelSchema.optional(), note: z.string().max(4000).optional() }).refine((value) => Boolean(value.carrierCustomerId || value.carrierName))
export const additionalLoadProposalSchema = z.object({ transportVersion: transportVersionSchema, customerId: z.uuid().optional(), customerName: labelSchema.optional(), pickupAddress: labelSchema, deliveryAddress: labelSchema, pickupWindowStart: z.iso.datetime().optional(), pickupWindowEnd: z.iso.datetime().optional(), cargoPallets: z.number().finite().nonnegative(), cargoWeightKg: z.number().finite().nonnegative(), clientPrice: z.number().finite().nonnegative(), currencyCode: z.string().regex(/^[A-Z]{3}$/).optional(), exchangeSource: z.enum(['manual', 'seed', 'trans', 'timocom']).default('manual'), exchangeRef: labelSchema.optional(), note: z.string().max(4000).optional() }).refine((value) => Boolean(value.customerId || value.customerName) && (value.cargoPallets > 0 || value.cargoWeightKg > 0))
export const transportOrderSchema = z.object({ id: z.uuid(), orderNumber: z.string(), currencyCode: z.string(), status: z.string(), customerId: z.uuid().nullable(), customerName: z.string(), updatedAt: z.iso.datetime(), fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])) })
export const freeSpaceSchema = z.object({ pallets: z.number().nullable(), kg: z.number().nullable(), limiting: z.enum(['pallets', 'kg']).nullable() })
export const transportDetailSchema = z.object({ transportVersion: z.string(), updatedAt: z.iso.datetime(), order1: transportOrderSchema, order2: transportOrderSchema.nullable(), carrierHistory: z.array(transportOrderSchema), additionalLoads: z.array(transportOrderSchema), freeSpace: freeSpaceSchema.nullable() })
export const salesTransportListQuerySchema = listQuerySchema.extend({ carrierStatus: z.enum(['none', 'pending_approval', 'approved']).optional(), sortField: z.enum(['updatedAt', 'pickupWindowStart']).default('updatedAt'), sortDir: z.enum(['asc', 'desc']).default('desc') })
