import type { ScheduleDefinition, Scenario } from './types'
import { parseDurationMs } from './interpolate'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Minimal 5-field cron: min hour dom mon dow. Supports star, N, star/N, A-B. */
export function cronMatches(expression: string, date = new Date()): boolean {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`[internal] Cron must have 5 fields: "${expression}"`)
  }
  const fields = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(),
  ]
  return parts.every((part, i) => matchField(part, fields[i], i === 4 ? 6 : i === 3 ? 12 : i === 2 ? 31 : i === 1 ? 23 : 59))
}

function matchField(part: string, value: number, max: number): boolean {
  if (part === '*') return true
  return part.split(',').some((token) => {
    if (token.includes('/')) {
      const [range, stepStr] = token.split('/')
      const step = Number(stepStr)
      if (!step) return false
      let start = 0
      let end = max
      if (range !== '*') {
        const [a, b] = range.split('-').map(Number)
        start = a
        end = Number.isFinite(b) ? b : a
      }
      for (let n = start; n <= end; n += step) if (n === value) return true
      return false
    }
    if (token.includes('-')) {
      const [a, b] = token.split('-').map(Number)
      return value >= a && value <= b
    }
    return Number(token) === value
  })
}

export async function runWithSchedule(
  scenario: Scenario,
  execute: (runIndex: number) => Promise<void>,
): Promise<void> {
  const schedule: ScheduleDefinition = scenario.schedule ?? { mode: 'once' }

  if (schedule.mode === 'once') {
    await execute(1)
    return
  }

  if (schedule.mode === 'at') {
    const at = new Date(schedule.at).getTime()
    const wait = at - Date.now()
    if (wait > 0) {
      console.log(`[schedule] waiting until ${schedule.at} (${wait}ms)`)
      await sleep(wait)
    }
    await execute(1)
    return
  }

  const until = 'until' in schedule && schedule.until ? new Date(schedule.until).getTime() : Infinity
  const maxRuns = 'maxRuns' in schedule ? schedule.maxRuns ?? Infinity : Infinity
  let run = 0

  if (schedule.mode === 'interval') {
    const everyMs =
      schedule.everyMs != null
        ? typeof schedule.everyMs === 'string'
          ? parseDurationMs(schedule.everyMs)
          : schedule.everyMs
        : schedule.every != null
          ? parseDurationMs(schedule.every)
          : (() => {
              throw new Error('[internal] interval schedule needs every / everyMs')
            })()
    while (run < maxRuns && Date.now() < until) {
      run++
      console.log(`[schedule] interval run #${run}`)
      await execute(run)
      if (run >= maxRuns || Date.now() >= until) break
      await sleep(everyMs)
    }
    return
  }

  if (schedule.mode === 'cron') {
    let lastMinute = -1
    console.log(`[schedule] cron "${schedule.expression}" (ctrl+c to stop)`)
    while (run < maxRuns && Date.now() < until) {
      const now = new Date()
      const minute = now.getMinutes()
      if (minute !== lastMinute && cronMatches(schedule.expression, now)) {
        lastMinute = minute
        run++
        console.log(`[schedule] cron run #${run} at ${now.toISOString()}`)
        await execute(run)
      }
      await sleep(1000)
    }
  }
}
