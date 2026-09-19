import { z } from 'zod'
import { parseScaledDecimal } from '../lib/decimal'

export const uuidSchema = z.string().uuid()
export const utcTimestampSchema = z.string().datetime({ offset: false })
export const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const reasonSchema = z.string().trim().min(1).max(2000)
const optionalNoteSchema = z.string().trim().max(2000).nullable().optional()

export const timezoneSchema = z.string().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}, { message: 'logistics.errors.invalidTimezone' })

export const weightSchema = z.string().regex(/^(0|[1-9]\d{0,8})(?:\.\d{1,3})?$/)
  .refine((value) => {
    try { return parseScaledDecimal(value, 3) > 0n } catch { return false }
  }, { message: 'logistics.errors.positiveWeight' })
export const odometerSchema = z.string().regex(/^(0|[1-9]\d{0,10})(?:\.\d)?$/)

export const placeSchema = z.object({
  label: z.string().trim().min(1).max(200),
  addressLine: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(200),
  postalCode: z.string().trim().max(40).nullable().optional(),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  timezone: timezoneSchema,
  contactName: z.string().trim().max(200).nullable().optional(),
  contactPhone: z.string().trim().max(80).nullable().optional(),
}).strict()

export const expectedRecordSchema = z.object({
  id: uuidSchema,
  expectedUpdatedAt: utcTimestampSchema,
}).strict()

export const actionSchema = expectedRecordSchema.extend({ requestId: uuidSchema })
export const factActionSchema = actionSchema.extend({ expectedFactRevision: revisionSchema })
export const planActionSchema = actionSchema.extend({ expectedPlanRevision: revisionSchema })
export const ledgerActionSchema = actionSchema.extend({ expectedLedgerRevision: revisionSchema })

export const vehicleProfileInputSchema = z.object({
  resourceId: uuidSchema,
  registration: z.string().trim().min(1).max(120).transform((value) => value.toUpperCase().replace(/\s+/g, '')),
  maxPayloadKg: weightSchema,
  maxPallets: z.number().int().nonnegative().max(100000).nullable(),
  dispatchEnabled: z.boolean(),
  lastKnownPlace: placeSchema.nullable(),
  lastKnownAt: utcTimestampSchema.nullable(),
  lastKnownSource: z.literal('manual_confirmation').nullable(),
}).strict().superRefine((value, context) => {
  const supplied = [value.lastKnownPlace, value.lastKnownAt, value.lastKnownSource].filter((entry) => entry !== null).length
  if (supplied !== 0 && supplied !== 3) {
    context.addIssue({ code: 'custom', path: ['lastKnownPlace'], message: 'logistics.errors.locationObservationIncomplete' })
  }
})

export const driverProfileInputSchema = z.object({
  staffMemberId: uuidSchema,
  dispatchEnabled: z.boolean(),
  dispatcherNotes: optionalNoteSchema,
}).strict()

export const jobStatusSchema = z.enum(['draft', 'ready', 'assigned', 'in_transit', 'delivered', 'returned', 'cancelled'])
export const tripStatusSchema = z.enum(['draft', 'planned', 'in_progress', 'completed', 'interrupted', 'cancelled'])

const jobFields = {
  customerId: uuidSchema,
  customerReference: z.string().trim().max(120).nullable().optional(),
  cargoDescription: z.string().trim().min(1).max(2000),
  weightKg: weightSchema,
  isPalletized: z.boolean(),
  pallets: z.number().int().positive().max(100000).nullable(),
  pickupPlace: placeSchema,
  deliveryPlace: placeSchema,
  pickupWindowStart: utcTimestampSchema,
  pickupWindowEnd: utcTimestampSchema,
  deliveryWindowStart: utcTimestampSchema,
  deliveryWindowEnd: utcTimestampSchema,
  notes: optionalNoteSchema,
}

const jobObjectSchema = z.object(jobFields).strict()
type JobFields = z.infer<typeof jobObjectSchema>

function validateJob(value: JobFields, context: z.RefinementCtx) {
  if (value.isPalletized !== (value.pallets !== null)) {
    context.addIssue({ code: 'custom', path: ['pallets'], message: 'logistics.errors.palletCountRequired' })
  }
  if (Date.parse(value.pickupWindowStart) > Date.parse(value.pickupWindowEnd)) {
    context.addIssue({ code: 'custom', path: ['pickupWindowEnd'], message: 'logistics.errors.invalidWindow' })
  }
  if (Date.parse(value.deliveryWindowStart) > Date.parse(value.deliveryWindowEnd)
    || Date.parse(value.pickupWindowStart) > Date.parse(value.deliveryWindowEnd)) {
    context.addIssue({ code: 'custom', path: ['deliveryWindowEnd'], message: 'logistics.errors.invalidWindow' })
  }
}

export const jobInputSchema = jobObjectSchema.superRefine(validateJob)
export const jobCreateSchema = jobObjectSchema.extend({ requestId: uuidSchema }).superRefine(validateJob)
export const jobUpdateSchema = jobObjectSchema.extend(actionSchema.shape).superRefine(validateJob)
export const jobCancelSchema = actionSchema.extend({ reason: reasonSchema })

export type Place = z.infer<typeof placeSchema>
export type JobInput = z.infer<typeof jobInputSchema>
export type JobCreate = z.infer<typeof jobCreateSchema>
export type JobUpdate = z.infer<typeof jobUpdateSchema>
export type VehicleProfileInput = z.infer<typeof vehicleProfileInputSchema>
export type DriverProfileInput = z.infer<typeof driverProfileInputSchema>
export type JobStatus = z.infer<typeof jobStatusSchema>
export type TripStatus = z.infer<typeof tripStatusSchema>
