import { z } from 'zod'
import {
  availabilityRangeSchema, availabilityRuleSchema, availabilityWindowSchema, parseSupportedRecurrence,
  type AvailabilityRange, type AvailabilityResult, type AvailabilityRule, type AvailabilityWindow,
} from '../data/availability'

export type AvailabilityMerger = (params: { rules: AvailabilityRule[]; range: AvailabilityRange }) => AvailabilityWindow[]

export function evaluateAvailability(
  selectedRules: readonly unknown[],
  range: AvailabilityRange,
  merge?: AvailabilityMerger | null,
): AvailabilityResult {
  const result = (status: AvailabilityResult['status'], reasonCode: AvailabilityResult['reasonCode'],
    ruleIds: string[] = [], windows: AvailabilityWindow[] = []): AvailabilityResult => ({
    status, reasonCode, ruleIds: [...new Set(ruleIds)].sort(), windows,
  })
  const parsedRange = availabilityRangeSchema.safeParse(range)
  if (!parsedRange.success) return result('unknown', 'invalid_range')
  const rules: AvailabilityRule[] = []
  const invalidIds: string[] = []
  const excludedIds: string[] = []
  const oneOffIds: string[] = []
  const overnightIds: string[] = []
  let invalid = false
  for (const input of selectedRules) {
    const parsed = availabilityRuleSchema.safeParse(input)
    const recurrence = parsed.success ? parseSupportedRecurrence(parsed.data.rrule) : null
    if (!parsed.success || !recurrence) {
      invalid = true
      const identity = z.object({ id: z.string() }).safeParse(input)
      if (identity.success) invalidIds.push(identity.data.id)
      continue
    }
    const rule = parsed.data
    rules.push(rule)
    if (recurrence.oneOff) {
      oneOffIds.push(rule.id)
      if (rule.exdates?.length) excludedIds.push(rule.id)
    } else if (recurrence.crossesMidnight) overnightIds.push(rule.id)
  }
  if (invalid) return result('unknown', 'unsupported_rule', invalidIds)
  if (excludedIds.length) return result('unknown', 'one_off_exdates', excludedIds)
  if (oneOffIds.length && overnightIds.length) return result('unknown', 'one_off_overnight', [...oneOffIds, ...overnightIds])
  const ruleIds = rules.map((rule) => rule.id)
  if (typeof merge !== 'function') return result('unknown', 'merger_unavailable', ruleIds)
  if (!rules.some((rule) => rule.kind === 'availability')) return result('ineligible', 'no_availability', ruleIds)
  let merged: unknown
  try {
    merged = merge({ rules, range: parsedRange.data })
  } catch {
    return result('unknown', 'merger_error', ruleIds)
  }
  const parsedWindows = z.array(availabilityWindowSchema).safeParse(merged)
  if (!parsedWindows.success) return result('unknown', 'invalid_windows', ruleIds)
  const start = range.start.getTime()
  const end = range.end.getTime()
  const clipped = parsedWindows.data.map((window) => ({
    start: Math.max(start, window.start.getTime()), end: Math.min(end, window.end.getTime()),
  })).filter((window) => window.start < window.end).sort((left, right) => left.start - right.start)
  const windows: AvailabilityWindow[] = []
  for (const window of clipped) {
    const previous = windows[windows.length - 1]
    if (previous && window.start <= previous.end.getTime()) {
      previous.end = new Date(Math.max(previous.end.getTime(), window.end))
    } else windows.push({ start: new Date(window.start), end: new Date(window.end) })
  }
  const covered = windows.length === 1 && windows[0].start.getTime() === start && windows[0].end.getTime() === end
  return result(covered ? 'eligible' : 'ineligible', covered ? 'covered' : 'coverage_gap', ruleIds, windows)
}
