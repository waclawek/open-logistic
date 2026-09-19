import { initialPlanSchema, type InitialPlan, type InitialPlanReasonCode } from '../data/planning'
import { validateInitialPlan } from '../lib/planning'

const jobId = 'aaaaaaaa-0000-4000-8000-000000000001'
const otherJobId = 'aaaaaaaa-0000-4000-8000-000000000002'
const unknownJobId = 'aaaaaaaa-0000-4000-8000-000000000003'
const stopId = (sequence: number) => `bbbbbbbb-0000-4000-8000-${String(sequence).padStart(12, '0')}`
const stop = (sequence: number, kind: InitialPlan['stops'][number]['kind'], selectedJobId: string | null) => ({
  id: stopId(sequence), kind, jobId: selectedJobId,
})

function plan(): InitialPlan {
  return {
    jobs: [{ id: jobId, weightKg: '0.1', isPalletized: true, pallets: 2 }],
    stops: [stop(1, 'pickup', jobId), stop(2, 'delivery', jobId), stop(3, 'end', null)],
    vehicle: { maxPayloadKg: '0.1', maxPallets: 2 },
  }
}

function twoJobPlan(concurrent: boolean): InitialPlan {
  const input = plan()
  input.jobs.push({ id: otherJobId, weightKg: '0.2', isPalletized: true, pallets: 3 })
  input.stops = concurrent
    ? [stop(1, 'pickup', jobId), stop(2, 'pickup', otherJobId), stop(3, 'delivery', jobId), stop(4, 'delivery', otherJobId), stop(5, 'end', null)]
    : [stop(1, 'pickup', jobId), stop(2, 'delivery', jobId), stop(3, 'pickup', otherJobId), stop(4, 'delivery', otherJobId), stop(5, 'end', null)]
  input.vehicle = { maxPayloadKg: '0.3', maxPallets: 5 }
  return input
}

function expectFailure(input: unknown, reasonCode: InitialPlanReasonCode, identity: { stopId?: string; jobId?: string } = {}) {
  expect(validateInitialPlan(input)).toEqual({ success: false, reasonCode, ...identity })
}

function deepFreeze(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
}

describe('validateInitialPlan', () => {
  it('returns independent after-stop snapshots and exact capacity equality', () => {
    const result = validateInitialPlan(twoJobPlan(true))
    expect(result).toEqual({
      success: true, peakWeightKg: '0.300', peakPallets: 5,
      stops: [
        { stopId: stopId(1), onboardJobIds: [jobId], weightKg: '0.100', pallets: 2 },
        { stopId: stopId(2), onboardJobIds: [jobId, otherJobId], weightKg: '0.300', pallets: 5 },
        { stopId: stopId(3), onboardJobIds: [otherJobId], weightKg: '0.200', pallets: 3 },
        { stopId: stopId(4), onboardJobIds: [], weightKg: '0.000', pallets: 0 },
        { stopId: stopId(5), onboardJobIds: [], weightKg: '0.000', pallets: 0 },
      ],
    })
  })

  it.each(['weight', 'pallets'] as const)('rejects transient %s overload although final load is zero', (dimension) => {
    const input = twoJobPlan(true)
    if (dimension === 'weight') input.vehicle.maxPayloadKg = '0.299'
    else input.vehicle.maxPallets = 4
    expectFailure(input, dimension === 'weight' ? 'payload_exceeded' : 'pallet_capacity_exceeded', { stopId: stopId(2), jobId: otherJobId })
  })

  it('allows sequential reuse of capacity but rejects concurrent loads', () => {
    const sequential = twoJobPlan(false)
    sequential.vehicle = { maxPayloadKg: '0.2', maxPallets: 3 }
    expect(validateInitialPlan(sequential)).toMatchObject({ success: true, peakWeightKg: '0.200', peakPallets: 3 })
    const concurrent = twoJobPlan(true)
    concurrent.vehicle = sequential.vehicle
    expectFailure(concurrent, 'payload_exceeded', { stopId: stopId(2), jobId: otherJobId })
  })

  it.each(['0.001', '1', '999999999.999'])('preserves scale and exact payload equality for %s', (weightKg) => {
    const input = plan()
    input.jobs[0].weightKg = weightKg
    input.vehicle.maxPayloadKg = weightKg
    expect(validateInitialPlan(input)).toMatchObject({ success: true, peakWeightKg: weightKg === '1' ? '1.000' : weightKg })
  })

  it('rejects unknown pallet capacity exactly when pallet cargo is loaded', () => {
    const input = twoJobPlan(false)
    input.jobs[0] = { ...input.jobs[0], isPalletized: false, pallets: null }
    input.vehicle.maxPallets = null
    expectFailure(input, 'pallet_capacity_unknown', { stopId: stopId(3), jobId: otherJobId })
  })

  it.each([null, 0])('allows nonpalletized cargo with pallet capacity %s and still counts its weight', (maxPallets) => {
    const input = plan()
    input.jobs[0] = { ...input.jobs[0], isPalletized: false, pallets: null }
    input.vehicle.maxPallets = maxPallets
    expect(validateInitialPlan(input)).toMatchObject({ success: true, peakWeightKg: '0.100', peakPallets: 0 })
    input.vehicle.maxPayloadKg = '0.099'
    expectFailure(input, 'payload_exceeded', { stopId: stopId(1), jobId })
  })

  it('counts mixed cargo weight and only palletized spaces', () => {
    const input = twoJobPlan(true)
    input.jobs[0] = { ...input.jobs[0], isPalletized: false, pallets: null }
    input.vehicle.maxPallets = 3
    expect(validateInitialPlan(input)).toMatchObject({ success: true, peakWeightKg: '0.300', peakPallets: 3 })
  })

  it('compares pallet sums exactly beyond safe integer range', () => {
    const input = twoJobPlan(true)
    input.jobs[0].pallets = Number.MAX_SAFE_INTEGER
    input.jobs[1].pallets = 1
    input.vehicle.maxPallets = Number.MAX_SAFE_INTEGER
    expectFailure(input, 'pallet_capacity_exceeded', { stopId: stopId(2), jobId: otherJobId })
    input.stops = twoJobPlan(false).stops
    expect(validateInitialPlan(input)).toMatchObject({ success: true, peakPallets: Number.MAX_SAFE_INTEGER })
  })

  it('treats differently cased UUIDs as the same identity', () => {
    const input = plan()
    input.stops[0].jobId = jobId.toUpperCase()
    expect(validateInitialPlan(input).success).toBe(true)
    input.jobs.push({ ...input.jobs[0], id: jobId.toUpperCase() })
    expectFailure(input, 'duplicate_job', { jobId })
  })

  const cases: Array<{ name: string; change: (input: InitialPlan) => void; reason: InitialPlanReasonCode; stopId?: string; jobId?: string }> = [
    { name: 'duplicate jobs', change: (input) => { input.jobs.push({ ...input.jobs[0] }) }, reason: 'duplicate_job', jobId },
    { name: 'duplicate stops', change: (input) => { input.stops[1].id = stopId(1).toUpperCase() }, reason: 'duplicate_stop', stopId: stopId(1), jobId },
    { name: 'unknown jobs', change: (input) => { input.stops[0].jobId = unknownJobId }, reason: 'unknown_job', stopId: stopId(1), jobId: unknownJobId },
    { name: 'null pickup reference', change: (input) => { input.stops[0].jobId = null }, reason: 'missing_stop_job', stopId: stopId(1) },
    { name: 'null delivery reference', change: (input) => { input.stops[1].jobId = null }, reason: 'missing_stop_job', stopId: stopId(2) },
    { name: 'job-bearing end', change: (input) => { input.stops[2].jobId = jobId }, reason: 'end_has_job', stopId: stopId(3), jobId },
    { name: 'missing end', change: (input) => { input.stops.pop() }, reason: 'missing_end' },
    { name: 'empty stops', change: (input) => { input.stops = [] }, reason: 'missing_end' },
    { name: 'duplicate end', change: (input) => { input.stops.push(stop(4, 'end', null)) }, reason: 'duplicate_end', stopId: stopId(4) },
    { name: 'nonfinal end', change: (input) => { input.stops = [input.stops[2], ...input.stops.slice(0, 2)] }, reason: 'end_not_final', stopId: stopId(3) },
    { name: 'delivery before pickup', change: (input) => { input.stops = [input.stops[1], input.stops[0], input.stops[2]] }, reason: 'delivery_before_pickup', stopId: stopId(2), jobId },
    { name: 'repeated pickup', change: (input) => { input.stops.splice(1, 0, stop(4, 'pickup', jobId)) }, reason: 'duplicate_pickup', stopId: stopId(4), jobId },
    { name: 'pickup after delivery', change: (input) => { input.stops.splice(2, 0, stop(4, 'pickup', jobId)) }, reason: 'duplicate_pickup', stopId: stopId(4), jobId },
    { name: 'repeated delivery', change: (input) => { input.stops.splice(2, 0, stop(4, 'delivery', jobId)) }, reason: 'duplicate_delivery', stopId: stopId(4), jobId },
    { name: 'missing delivery leaves cargo', change: (input) => { input.stops.splice(1, 1) }, reason: 'end_with_cargo', stopId: stopId(3), jobId },
    { name: 'selected job without stops', change: (input) => { input.jobs.push({ ...input.jobs[0], id: otherJobId }) }, reason: 'missing_pickup', stopId: stopId(3), jobId: otherJobId },
    { name: 'end only', change: (input) => { input.stops = [input.stops[2]] }, reason: 'missing_pickup', stopId: stopId(3), jobId },
    { name: 'zero pallet capacity', change: (input) => { input.vehicle.maxPallets = 0 }, reason: 'pallet_capacity_exceeded', stopId: stopId(1), jobId },
  ]
  it.each(cases)('rejects $name', ({ change, reason, stopId: failedStopId, jobId: failedJobId }) => {
    const input = plan()
    change(input)
    expectFailure(input, reason, { ...(failedStopId ? { stopId: failedStopId } : {}), ...(failedJobId ? { jobId: failedJobId } : {}) })
  })

  it.each(['0', '0.000', '-1', '0.0001', '1.2345', '01', ' 1', '1 ', '1e3', 'NaN', 'Infinity', '1000000000', '', 1, null])('rejects malformed/zero weight %s in both fields', (value) => {
    const input = plan()
    expectFailure({ ...input, jobs: [{ ...input.jobs[0], weightKg: value }] }, 'invalid_input')
    expectFailure({ ...input, vehicle: { ...input.vehicle, maxPayloadKg: value } }, 'invalid_input')
  })

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '2', undefined])('rejects malformed pallet counts %s', (value) => {
    const input = plan()
    expectFailure({ ...input, jobs: [{ ...input.jobs[0], pallets: value }] }, 'invalid_input')
    expectFailure({ ...input, vehicle: { ...input.vehicle, maxPallets: value } }, 'invalid_input')
  })

  it.each([{ isPalletized: true, pallets: null }, { isPalletized: true, pallets: 0 }, { isPalletized: false, pallets: 2 }])('rejects inconsistent pallet policy %j', (policy) => {
    const input = plan()
    expectFailure({ ...input, jobs: [{ ...input.jobs[0], ...policy }] }, 'invalid_input')
  })

  it('rejects unknown fields, absent references and unsupported recovery/execution input', () => {
    const input = plan()
    const malformed: unknown[] = [null, undefined, {}, [], { ...input, jobs: [] },
      { ...input, onboardJobIds: [] },
      { ...input, jobs: [{ ...input.jobs[0], status: 'ready' }] },
      { ...input, vehicle: { ...input.vehicle, available: true } },
      { ...input, stops: [{ ...input.stops[0], extra: true }] },
      { ...input, stops: [{ id: stopId(1), kind: 'pickup' }] },
      { ...input, stops: [{ ...input.stops[0], kind: 'handover_in' }] },
      { ...input, stops: [{ ...input.stops[0], kind: 'return' }] },
      { ...input, stops: [{ ...input.stops[0], jobId: 'bad-id' }] },
      { ...input, stops: [{ ...input.stops[0], id: 'bad-id' }] },
      { ...input, jobs: [{ ...input.jobs[0], id: 'bad-id' }] },
      { ...input, jobs: [{ ...input.jobs[0], isPalletized: 'true' }] },
    ]
    for (const raw of malformed) {
      expect(initialPlanSchema.safeParse(raw).success).toBe(false)
      expectFailure(raw, 'invalid_input')
    }
  })

  it.each([true, false])('does not mutate frozen inputs or share result arrays (valid=%s)', (valid) => {
    const input = twoJobPlan(true)
    if (!valid) input.vehicle.maxPayloadKg = '0.299'
    const before = JSON.stringify(input)
    deepFreeze(input)
    const first = validateInitialPlan(input)
    const second = validateInitialPlan(input)
    expect(first).toEqual(second)
    expect(JSON.stringify(input)).toBe(before)
    if (first.success && second.success) {
      first.stops[0].onboardJobIds.length = 0
      expect(second.stops[0].onboardJobIds).toEqual([jobId])
      expect(first.stops[1].onboardJobIds).toEqual([jobId, otherJobId])
    }
  })
})
