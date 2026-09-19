import {
  initialPlanSchema,
  type InitialPlanReasonCode,
  type InitialPlanStopLoad,
  type InitialPlanValidationResult,
} from '../data/planning'
import { formatScaledDecimal, parseScaledDecimal } from './decimal'

function failure(reasonCode: InitialPlanReasonCode, identity: { stopId?: string; jobId?: string } = {}): InitialPlanValidationResult {
  return { success: false, reasonCode, ...identity }
}

/** Initial ready-job plans only; callers own authorization, versions, state, reservations, timing and availability. */
export function validateInitialPlan(raw: unknown): InitialPlanValidationResult {
  const parsed = initialPlanSchema.safeParse(raw)
  if (!parsed.success) return failure('invalid_input')
  const { jobs, stops, vehicle } = parsed.data
  const jobsById = new Map<string, typeof jobs[number]>()
  for (const job of jobs) {
    if (jobsById.has(job.id)) return failure('duplicate_job', { jobId: job.id })
    jobsById.set(job.id, job)
  }
  const stopIds = new Set<string>()
  let endId: string | undefined
  for (const stop of stops) {
    const identity = { stopId: stop.id, ...(stop.jobId === null ? {} : { jobId: stop.jobId }) }
    if (stopIds.has(stop.id)) return failure('duplicate_stop', identity)
    stopIds.add(stop.id)
    if (stop.kind === 'end') {
      if (stop.jobId !== null) return failure('end_has_job', identity)
      if (endId !== undefined) return failure('duplicate_end', identity)
      endId = stop.id
    } else {
      if (stop.jobId === null) return failure('missing_stop_job', identity)
      if (!jobsById.has(stop.jobId)) return failure('unknown_job', identity)
    }
  }
  if (endId === undefined) return failure('missing_end')
  if (stops[stops.length - 1].id !== endId) return failure('end_not_final', { stopId: endId })

  const maxWeight = parseScaledDecimal(vehicle.maxPayloadKg, 3)
  const maxPallets = vehicle.maxPallets === null ? null : BigInt(vehicle.maxPallets)
  const pickedUp = new Set<string>()
  const delivered = new Set<string>()
  const onboard = new Set<string>()
  const loads: InitialPlanStopLoad[] = []
  let weight = 0n
  let pallets = 0n
  let peakWeight = 0n
  let peakPallets = 0n
  for (const stop of stops) {
    if (stop.kind === 'end') {
      const onboardJobId = onboard.values().next().value
      if (onboardJobId !== undefined) return failure('end_with_cargo', { stopId: stop.id, jobId: onboardJobId })
      const missingJob = jobs.find((job) => !pickedUp.has(job.id))
      if (missingJob) return failure('missing_pickup', { stopId: stop.id, jobId: missingJob.id })
    } else {
      const job = stop.jobId === null ? undefined : jobsById.get(stop.jobId)
      if (!job) return failure('invalid_input')
      const identity = { stopId: stop.id, jobId: job.id }
      const jobWeight = parseScaledDecimal(job.weightKg, 3)
      const jobPallets = BigInt(job.pallets ?? 0)
      if (stop.kind === 'pickup') {
        if (pickedUp.has(job.id)) return failure('duplicate_pickup', identity)
        pickedUp.add(job.id)
        onboard.add(job.id)
        weight += jobWeight
        pallets += jobPallets
      } else {
        if (delivered.has(job.id)) return failure('duplicate_delivery', identity)
        if (!pickedUp.has(job.id)) return failure('delivery_before_pickup', identity)
        delivered.add(job.id)
        onboard.delete(job.id)
        weight -= jobWeight
        pallets -= jobPallets
      }
      if (weight > maxWeight) return failure('payload_exceeded', identity)
      if (pallets > 0n && maxPallets === null) return failure('pallet_capacity_unknown', identity)
      if (maxPallets !== null && pallets > maxPallets) return failure('pallet_capacity_exceeded', identity)
    }
    if (weight > peakWeight) peakWeight = weight
    if (pallets > peakPallets) peakPallets = pallets
    loads.push({ stopId: stop.id, onboardJobIds: [...onboard], weightKg: formatScaledDecimal(weight, 3), pallets: Number(pallets) })
  }
  return { success: true, stops: loads, peakWeightKg: formatScaledDecimal(peakWeight, 3), peakPallets: Number(peakPallets) }
}
