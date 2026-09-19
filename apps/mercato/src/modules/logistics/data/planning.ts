import { z } from 'zod'
import { uuidSchema, weightSchema } from './validators'

const planIdSchema = uuidSchema.transform((value) => value.toLowerCase())
const palletCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

export const initialPlanSchema = z.object({
  jobs: z.array(z.object({
    id: planIdSchema,
    weightKg: weightSchema,
    isPalletized: z.boolean(),
    pallets: palletCountSchema.positive().nullable(),
  }).strict().refine((job) => job.isPalletized === (job.pallets !== null))).min(1),
  stops: z.array(z.object({
    id: planIdSchema,
    kind: z.enum(['pickup', 'delivery', 'end']),
    jobId: planIdSchema.nullable(),
  }).strict()),
  vehicle: z.object({
    maxPayloadKg: weightSchema,
    maxPallets: palletCountSchema.nullable(),
  }).strict(),
}).strict()

export type InitialPlan = z.infer<typeof initialPlanSchema>

export type InitialPlanStopLoad = {
  stopId: string
  onboardJobIds: string[]
  weightKg: string
  pallets: number
}

export type InitialPlanReasonCode =
  | 'invalid_input'
  | 'duplicate_job'
  | 'duplicate_stop'
  | 'missing_end'
  | 'duplicate_end'
  | 'end_not_final'
  | 'end_has_job'
  | 'missing_stop_job'
  | 'unknown_job'
  | 'duplicate_pickup'
  | 'duplicate_delivery'
  | 'delivery_before_pickup'
  | 'missing_pickup'
  | 'end_with_cargo'
  | 'payload_exceeded'
  | 'pallet_capacity_unknown'
  | 'pallet_capacity_exceeded'

export type InitialPlanValidationResult =
  | { success: true; stops: InitialPlanStopLoad[]; peakWeightKg: string; peakPallets: number }
  | { success: false; reasonCode: InitialPlanReasonCode; stopId?: string; jobId?: string }
