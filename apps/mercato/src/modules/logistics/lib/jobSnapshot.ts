import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { loadCustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { jobInputSchema, utcTimestampSchema, uuidSchema } from '../data/validators'
import type { TransportJob } from '../data/entities'
import { formatScaledDecimal, parseScaledDecimal } from './decimal'

export const jobSnapshotSchema = z.object({
  id: uuidSchema, tenantId: uuidSchema, organizationId: uuidSchema,
  reference: z.string(), customerNameSnapshot: z.string(), updatedAt: utcTimestampSchema,
  values: jobInputSchema, custom: z.record(z.string(), z.unknown()),
}).strict()
export type JobSnapshot = z.infer<typeof jobSnapshotSchema>

export function jobValues(job: TransportJob) {
  return jobInputSchema.parse({ customerId: job.customerId, customerReference: job.customerReference,
    cargoDescription: job.cargoDescription, weightKg: formatScaledDecimal(parseScaledDecimal(job.weightKg, 3), 3), isPalletized: job.isPalletized, pallets: job.pallets,
    pickupPlace: job.pickupPlace, deliveryPlace: job.deliveryPlace, pickupWindowStart: job.pickupWindowStart.toISOString(),
    pickupWindowEnd: job.pickupWindowEnd.toISOString(), deliveryWindowStart: job.deliveryWindowStart.toISOString(),
    deliveryWindowEnd: job.deliveryWindowEnd.toISOString(), notes: job.notes })
}

export function applyJobValues(job: TransportJob, values: z.infer<typeof jobInputSchema>) {
  Object.assign(job, { customerId: values.customerId, customerReference: values.customerReference ?? null, notes: values.notes ?? null,
    cargoDescription: values.cargoDescription, weightKg: formatScaledDecimal(parseScaledDecimal(values.weightKg, 3), 3), isPalletized: values.isPalletized, pallets: values.pallets,
    pickupPlace: values.pickupPlace, deliveryPlace: values.deliveryPlace,
    pickupWindowStart: new Date(values.pickupWindowStart), pickupWindowEnd: new Date(values.pickupWindowEnd),
    deliveryWindowStart: new Date(values.deliveryWindowStart), deliveryWindowEnd: new Date(values.deliveryWindowEnd) })
}

export async function snapshotJob(em: EntityManager, job: TransportJob): Promise<JobSnapshot> {
  const custom = await loadCustomFieldSnapshot(em, { entityId: 'logistics:transport_job', recordId: job.id,
    tenantId: job.tenantId, organizationId: job.organizationId })
  return jobSnapshotSchema.parse({ id: job.id, tenantId: job.tenantId, organizationId: job.organizationId,
    reference: job.reference, customerNameSnapshot: job.customerNameSnapshot, updatedAt: job.updatedAt.toISOString(),
    values: jobValues(job), custom: Object.fromEntries(Object.entries(custom).filter(([, value]) =>
      value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0))) })
}
