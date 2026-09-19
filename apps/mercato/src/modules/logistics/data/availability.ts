import { z } from 'zod'

function validUtc(value: string): boolean {
  if (/\s/.test(value)) return false
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z)?$/.exec(value)
  if (!match || Number(match[2] ?? 0) > 23 || Number(match[3] ?? 0) > 59 || Number(match[4] ?? 0) > 59) return false
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === match[1]
}

export const availabilityRuleSchema = z.object({
  id: z.string().min(1),
  rrule: z.string().min(1),
  kind: z.enum(['availability', 'unavailability']),
  exdates: z.array(z.string().refine(validUtc)).optional(),
}).refine((rule) => parseSupportedRecurrence(rule.rrule) !== null)

export const availabilityRangeSchema = z.object({ start: z.date(), end: z.date() })
  .refine(({ start, end }) => start.getTime() < end.getTime())

export const availabilityWindowSchema = z.object({
  start: z.date(),
  end: z.date(),
  ruleId: z.string().optional(),
}).refine(({ start, end }) => start.getTime() < end.getTime())

export const availabilityResultSchema = z.object({
  status: z.enum(['eligible', 'ineligible', 'unknown']),
  reasonCode: z.enum(['covered', 'coverage_gap', 'no_availability', 'invalid_range', 'unsupported_rule',
    'one_off_exdates', 'one_off_overnight', 'merger_unavailable', 'merger_error', 'invalid_windows']),
  ruleIds: z.array(z.string()),
  windows: z.array(availabilityWindowSchema),
})

export type AvailabilityRule = z.infer<typeof availabilityRuleSchema>
export type AvailabilityRange = z.infer<typeof availabilityRangeSchema>
export type AvailabilityWindow = z.infer<typeof availabilityWindowSchema>
export type AvailabilityResult = z.infer<typeof availabilityResultSchema>

export function parseSupportedRecurrence(rrule: string) {
  if (/\s/.test(rrule)) return null
  const clauses = new Map<string, string>()
  for (const clause of rrule.split(';')) {
    const match = /^(DTSTART[:=]|DURATION:|FREQ=|COUNT=|BYDAY=)([^;]+)$/.exec(clause)
    if (!match) return null
    const key = match[1].slice(0, -1)
    if (clauses.has(key)) return null
    clauses.set(key, match[2])
  }
  const start = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})00Z$/.exec(clauses.get('DTSTART') ?? '')
  const duration = /^PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(clauses.get('DURATION') ?? '')
  if (!start || !duration || (!duration[1] && !duration[2])) return null
  const iso = `${start[1]}-${start[2]}-${start[3]}T${start[4]}:${start[5]}:00Z`
  if (!validUtc(iso)) return null
  const durationMinutes = Number(duration[1] ?? 0) * 60 + Number(duration[2] ?? 0)
  if (!Number.isSafeInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 1440) return null
  const minuteOfDay = Number(start[4]) * 60 + Number(start[5])
  const frequency = clauses.get('FREQ')
  const count = clauses.get('COUNT')
  const byDay = clauses.get('BYDAY')
  if (frequency === 'DAILY') {
    if (byDay !== undefined || (count !== undefined && count !== '1')) return null
    if (count === '1' && (minuteOfDay !== 0 || durationMinutes !== 1440)) return null
  } else if (frequency === 'WEEKLY') {
    const weekday = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][new Date(iso).getUTCDay()]
    if (count !== undefined || (byDay !== undefined && byDay !== weekday)) return null
  } else return null
  return { oneOff: count === '1', crossesMidnight: minuteOfDay + durationMinutes > 1440 }
}
