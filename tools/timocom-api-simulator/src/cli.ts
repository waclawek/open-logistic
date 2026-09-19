#!/usr/bin/env node
import path from 'node:path'
import { loadCatalog, resolveDocsRoot } from './catalog'
import { listTemplates } from './generators'
import { startMockServer } from './mock-server'
import { loadScenarioFile, runScenarioOnce } from './runner'
import { runWithSchedule } from './scheduler'
import { parseDurationMs } from './interpolate'

function usage() {
  console.log(`timocom-api-simulator — fire TIMOCOM Freight Exchange mock traffic at Open Mercato

Docs: https://developer.timocom.com/ (Freight Exchange v3 OpenAPI in timocom_api_doc/)

Usage:
  yarn timocom:sim catalog [--q search]
  yarn timocom:sim templates
  yarn timocom:sim run <scenario.yaml> [--dry-run] [--base-url URL]
  yarn timocom:sim mock-server [--port 4100] [--latency 25]

Env:
  TARGET_BASE_URL          destination (OM or mock)
  TIMOCOM_SIM_BASIC        optional Basic auth value (group:password or already base64)
  TRANS_INBOX_TENANT_ID    optional X-Om-Tenant-Id for live inbox SSE
`)
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  return args[i + 1]
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name)
}

async function main() {
  const [, , cmd, ...rest] = process.argv
  if (!cmd || cmd === '-h' || cmd === '--help') {
    usage()
    process.exit(0)
  }

  const docsRoot = resolveDocsRoot()
  const catalog = loadCatalog(docsRoot)

  if (cmd === 'catalog') {
    const q = (argValue(rest, '--q') ?? '').toLowerCase()
    const rows = catalog.filter((op) => {
      if (!q) return true
      return (
        op.key.toLowerCase().includes(q) ||
        (op.operationId?.toLowerCase().includes(q) ?? false) ||
        (op.summary?.toLowerCase().includes(q) ?? false)
      )
    })
    for (const op of rows) {
      console.log(`${op.key.padEnd(72)} ${op.summary ?? op.operationId ?? ''}`)
    }
    console.log(`\n${rows.length} operations (docs: ${docsRoot})`)
    return
  }

  if (cmd === 'templates') {
    for (const t of listTemplates()) console.log(t)
    return
  }

  if (cmd === 'mock-server') {
    const port = Number(argValue(rest, '--port') ?? 4100)
    const latency = Number(argValue(rest, '--latency') ?? 25)
    startMockServer({ port, catalog, latencyMs: latency })
    return
  }

  if (cmd === 'run') {
    const file = rest.find((a) => !a.startsWith('-'))
    if (!file) {
      console.error('Missing scenario file')
      usage()
      process.exit(1)
    }
    const scenario = loadScenarioFile(path.resolve(file))
    if (hasFlag(rest, '--dry-run')) {
      scenario.defaults = { ...(scenario.defaults ?? {}), dryRun: true }
    }
    const baseUrl = argValue(rest, '--base-url')
    if (baseUrl) scenario.target.baseUrl = baseUrl
    if (process.env.TARGET_BASE_URL && (!scenario.target.baseUrl || scenario.target.baseUrl.includes('${'))) {
      scenario.target.baseUrl = process.env.TARGET_BASE_URL
    }

    const schedule = scenario.schedule as
      | { mode: string; every?: string | number; everyMs?: number }
      | undefined
    if (schedule?.mode === 'interval' && schedule.every != null && schedule.everyMs == null) {
      ;(scenario.schedule as { everyMs: number }).everyMs = parseDurationMs(schedule.every)
    }

    await runWithSchedule(scenario, async (runIndex) => {
      const { stats, results } = await runScenarioOnce(scenario, catalog, runIndex)
      console.log(
        JSON.stringify(
          {
            run: stats.run,
            total: stats.total,
            ok: stats.ok,
            failed: stats.failed,
            avgMs: stats.avgMs,
            p95Ms: stats.p95Ms,
            byStatus: stats.byStatus,
            byBatch: stats.byBatch,
            reportPath: scenario.reportPath ?? null,
          },
          null,
          2,
        ),
      )
      for (const f of results.filter((r) => !r.ok).slice(0, 5)) {
        console.error(`FAIL ${f.method} ${f.url} → ${f.status} ${f.error ?? ''}`)
      }
    })
    return
  }

  console.error(`Unknown command: ${cmd}`)
  usage()
  process.exit(1)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
