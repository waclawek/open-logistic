import { getMergedAvailabilityWindows } from '@open-mercato/core/modules/planner/lib/availabilityMerge'
import { availabilityRuleSchema, type AvailabilityRule, type AvailabilityRange } from '../data/availability'
import { evaluateAvailability } from '../lib/availability'

const rule = (rrule = 'DTSTART:20260921T080000Z;DURATION:PT8H;FREQ=WEEKLY;BYDAY=MO',
  overrides: Partial<AvailabilityRule> = {}): AvailabilityRule => ({ id: 'available', rrule, kind: 'availability', ...overrides })
const range = (start = '2026-09-21T08:00:00Z', end = '2026-09-21T16:00:00Z'): AvailabilityRange => ({
  start: new Date(start), end: new Date(end),
})
const oneOff = rule('DTSTART:20260922T000000Z;DURATION:PT24H;FREQ=DAILY;COUNT=1', { id: 'override', kind: 'unavailability' })
const evaluate = (rules: readonly unknown[], interval = range()) => evaluateAvailability(rules, interval, getMergedAvailabilityWindows)

describe('supported availability grammar', () => {
  it.each([
    'DTSTART:20260921T080000Z;DURATION:PT8H;FREQ=DAILY',
    'FREQ=WEEKLY;DTSTART=20260921T080000Z;DURATION:PT480M',
    'DTSTART:20260921T080000Z;DURATION:PT1H30M;FREQ=WEEKLY;BYDAY=MO',
    'DTSTART:20260921T000000Z;DURATION:PT1440M;FREQ=DAILY;COUNT=1',
    'DTSTART:20240229T080000Z;DURATION:PT1M;FREQ=DAILY',
  ])('accepts the complete supported expression %s', (rrule) => {
    expect(availabilityRuleSchema.safeParse(rule(rrule)).success).toBe(true)
  })

  it.each([
    'DTSTART:20260921T080030Z;DURATION:PT8H;FREQ=DAILY',
    'DTSTART:20260921T080000.000Z;DURATION:PT8H;FREQ=DAILY',
    'DTSTART:20260921T080000;DURATION:PT8H;FREQ=DAILY',
    'DTSTART:20260921T080000+0200;DURATION:PT8H;FREQ=DAILY',
    'DTSTART:20260230T080000Z;DURATION:PT8H;FREQ=DAILY',
    'DTSTART:20260229T080000Z;DURATION:PT8H;FREQ=DAILY',
    'DTSTART:20261301T080000Z;DURATION:PT8H;FREQ=DAILY',
    'DTSTART:20260921T240000Z;DURATION:PT8H;FREQ=DAILY',
    'DTSTART:20260921T086000Z;DURATION:PT8H;FREQ=DAILY',
    'DTSTART:20260921T080000Z;DURATION:PT0M;FREQ=DAILY',
    'DTSTART:20260921T080000Z;DURATION:PT;FREQ=DAILY',
    'DTSTART:20260921T080000Z;DURATION:PT1.5H;FREQ=DAILY',
    'DTSTART:20260921T080000Z;DURATION:PT1H30S;FREQ=DAILY',
    'DTSTART:20260921T080000Z;DURATION:PT-1H;FREQ=DAILY',
    'DTSTART:20260921T080000Z;DURATION:P1D;FREQ=DAILY',
    'DTSTART:20260921T080000Z;DURATION:PT1441M;FREQ=DAILY',
    'DTSTART:20260921T080000Z;DURATION:PT999999999999999999999H;FREQ=DAILY',
    'DTSTART:20260921T080000Z;DURATION:PT8H;FREQ=MONTHLY',
    'DTSTART:20260921T080000Z;DURATION:PT8H;FREQ=DAILY;COUNT=2',
    'DTSTART:20260921T000000Z;DURATION:PT24H;FREQ=WEEKLY;COUNT=1',
    'DTSTART:20260921T080000Z;DURATION:PT8H;FREQ=WEEKLY;BYDAY=TU',
    'DTSTART:20260921T080000Z;DURATION:PT8H;FREQ=WEEKLY;BYDAY=MO,TU',
    'DTSTART:20260921T080000Z;DURATION:PT8H;FREQ=WEEKLY;BYDAY=1MO',
    'DTSTART:20260921T080000Z;DURATION:PT8H;FREQ=DAILY;BYDAY=MO',
    'DTSTART:20260921T000000Z;DURATION:PT8H;FREQ=DAILY;COUNT=1',
    'DTSTART:20260921T100000Z;DURATION:PT24H;FREQ=DAILY;COUNT=1',
    'DURATION:PT8H;FREQ=DAILY',
    'DTSTART:20260921T080000Z;FREQ=DAILY',
    'DTSTART:20260921T080000Z;DURATION:PT8H',
  ])('rejects unsupported expression before merging: %s', (rrule) => {
    const merge = jest.fn(getMergedAvailabilityWindows)
    expect(evaluateAvailability([rule(rrule)], range(), merge)).toMatchObject({ status: 'unknown', reasonCode: 'unsupported_rule', ruleIds: ['available'] })
    expect(merge).not.toHaveBeenCalled()
  })

  it.each([';UNTIL=20260922T000000Z', ';INTERVAL=1', ';WKST=MO', ';FREQ=DAILY', ';DTSTART=20260921T080000Z',
    ';DURATION:PT1H', ';BYDAY=MO', ';COUNT=1;COUNT=1', ';', ';garbage', '\nFREQ=DAILY', '\n', 'junk'])('rejects unknown, duplicate or malformed clauses: %s', (suffix) => {
    expect(evaluate([rule(rule().rrule + suffix)]).status).toBe('unknown')
  })

  it.each(['2026-02-30', '2026-02-29T08:00:00Z', '2026-09-21T24:00:00Z', '2026-09-21T08:00:60Z',
    '2026-09-21T08:00:00+02:00', '20260921', '2026-9-21', '', ' 2026-09-21', '2026-09-21\n', 'invalid'])('rejects malformed exclusion %s', (exdate) => {
    expect(evaluate([rule(undefined, { exdates: [exdate] })]).reasonCode).toBe('unsupported_rule')
  })

  it.each([undefined, null, '', 'available'])('rejects missing or unknown kind %s', (kind) => {
    expect(evaluate([{ ...rule(), kind }]).status).toBe('unknown')
  })

  it('never silently omits a malformed blocker', () => {
    const merge = jest.fn(getMergedAvailabilityWindows)
    expect(evaluateAvailability([rule(), rule('broken', { kind: 'unavailability', id: 'blocker' })], range(), merge))
      .toMatchObject({ status: 'unknown', ruleIds: ['blocker'] })
    expect(merge).not.toHaveBeenCalled()
  })

  it.each(['availability', 'unavailability'] as const)('rejects excluded one-offs of kind %s', (kind) => {
    expect(evaluate([{ ...oneOff, kind, exdates: ['2026-09-22'] }])).toMatchObject({ status: 'unknown', reasonCode: 'one_off_exdates', ruleIds: ['override'] })
  })

  it.each(['availability', 'unavailability'] as const)('rejects overnight %s with any one-off', (kind) => {
    const overnight = rule('DTSTART:20260921T170000Z;DURATION:PT8H;FREQ=DAILY', { id: 'overnight', kind })
    expect(evaluate([oneOff, overnight])).toMatchObject({ status: 'unknown', reasonCode: 'one_off_overnight', ruleIds: ['overnight', 'override'] })
  })
})

describe('existing planner semantics and complete interval coverage', () => {
  it('covers a matching UTC weekday and subtracts daytime unavailability', () => {
    const blocker = rule('DTSTART:20260921T100000Z;DURATION:PT1H;FREQ=WEEKLY', { id: 'blocker', kind: 'unavailability' })
    expect(evaluate([rule()]).status).toBe('eligible')
    const blocked = evaluate([rule(), blocker])
    expect(blocked.status).toBe('ineligible')
    expect(blocked.windows).toEqual([range('2026-09-21T08:00:00Z', '2026-09-21T10:00:00Z'), range('2026-09-21T11:00:00Z', '2026-09-21T16:00:00Z')])
    expect(evaluate([rule(), blocker], range('2026-09-21T11:00:00Z')).status).toBe('eligible')
  })

  it.each(['2026-09-21', '2026-09-21T08:00:00Z', '2026-09-21T08:00:00.000Z'])('honors recurring exclusion %s', (exdate) => {
    expect(evaluate([rule(undefined, { exdates: [exdate] })]).status).toBe('ineligible')
  })

  it('honors whole UTC-day overrides and rejects the seconds tail', () => {
    const exact = rule('DTSTART:20260921T160000Z;DURATION:PT8H;FREQ=DAILY')
    expect(evaluate([exact, oneOff], range('2026-09-22T00:00:00Z', '2026-09-22T00:00:30Z')).status).toBe('ineligible')
    expect(evaluate([exact, oneOff], range('2026-09-21T16:00:00Z', '2026-09-22T00:00:00Z')).status).toBe('eligible')
    expect(evaluate([rule(exact.rrule.replace('160000', '160030')), oneOff]).reasonCode).toBe('unsupported_rule')
    expect(evaluate([{ ...oneOff, kind: 'availability' }], range('2026-09-22T00:00:00Z', '2026-09-23T00:00:00Z')).status).toBe('eligible')
  })

  it('supports an overnight recurrence without one-offs', () => {
    expect(evaluate([rule('DTSTART:20260921T220000Z;DURATION:PT8H;FREQ=DAILY')], range('2026-09-22T01:00:00Z', '2026-09-22T06:00:00Z')).status).toBe('eligible')
  })

  it('clips and unions unsorted, overlapping and adjacent windows without filling gaps', () => {
    const merge = jest.fn(() => [range('2026-09-21T12:00:00Z', '2026-09-21T17:00:00Z'), range('2026-09-21T07:00:00Z', '2026-09-21T12:00:00Z'), range('2026-09-21T09:00:00Z', '2026-09-21T10:00:00Z')])
    expect(evaluateAvailability([rule()], range(), merge)).toMatchObject({ status: 'eligible', windows: [range()] })
    merge.mockReturnValue([range('2026-09-21T08:00:00Z', '2026-09-21T12:00:00Z'), range('2026-09-21T12:00:00.001Z', '2026-09-21T16:00:00Z')])
    expect(evaluateAvailability([rule()], range(), merge).status).toBe('ineligible')
  })

  it('cannot infer coverage from empty or blocker-only schedules', () => {
    expect(evaluate([])).toMatchObject({ status: 'ineligible', reasonCode: 'no_availability' })
    expect(evaluate([oneOff]).status).toBe('ineligible')
    expect(evaluateAvailability([rule()], range(), () => []).status).toBe('ineligible')
  })

  it.each([range('invalid'), range('2026-09-21T16:00:00Z'), range('2026-09-22T08:00:00Z')])('rejects invalid or nonpositive ranges', (interval) => {
    const merge = jest.fn(getMergedAvailabilityWindows)
    expect(evaluateAvailability([rule()], interval, merge).reasonCode).toBe('invalid_range')
    expect(merge).not.toHaveBeenCalled()
  })

  it('returns unknown when the merger is absent or fails', () => {
    expect(evaluateAvailability([rule()], range()).reasonCode).toBe('merger_unavailable')
    expect(evaluateAvailability([rule()], range(), () => { throw new Error('[internal] merger failed') }).reasonCode).toBe('merger_error')
  })

  it.each([range('invalid'), range('2026-09-21T16:00:00Z'), range('2026-09-22T08:00:00Z')])('rejects invalid merger windows even alongside full coverage', (window) => {
    expect(evaluateAvailability([rule()], range(), () => [range(), window]).reasonCode).toBe('invalid_windows')
  })
})
