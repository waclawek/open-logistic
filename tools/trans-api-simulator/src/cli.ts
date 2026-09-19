#!/usr/bin/env node
import path from 'node:path'
import { loadCatalog, resolveDocsRoot } from './catalog'
import { listTemplates } from './generators'
import { startMockServer } from './mock-server'
import { loadScenarioFile, runScenarioOnce } from './runner'
import { runWithSchedule } from './scheduler'

function usage() {
  console.log(`trans-api-simulator — fire Trans.eu-shaped mock traffic at Open Mercato

Usage:
  yarn trans:sim catalog [--api freights-api] [--q search]
  yarn trans:sim templates
  yarn trans:sim run <scenario.yaml> [--dry-run] [--base-url URL]
  yarn trans:sim mock-server [--port 4099] [--latency 25]

Env:
  TRANS_INBOX_TOKEN shared diagnostic inbox token (required for application capture)
  TARGET_BASE_URL   default destination (scenario can override)
  TRANS_SIM_TOKEN   optional bearer token injected if scenario uses \${TRANS_SIM_TOKEN}
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
    const api = argValue(rest, '--api')
    const q = (argValue(rest, '--q') ?? '').toLowerCase()
    const rows = catalog.filter((op) => {
      if (api && op.api !== api) return false
      if (!q) return true
      return (
        op.key.toLowerCase().includes(q) ||
        (op.operationId?.toLowerCase().includes(q) ?? false) ||
        (op.summary?.toLowerCase().includes(q) ?? false)
      )
    })
    for (const op of rows) {
      console.log(`${op.key.padEnd(72)} ${op.api}  ${op.operationId ?? ''}`)
    }
    console.log(`\n${rows.length} operations (docs: ${docsRoot})`)
    return
  }

  if (cmd === 'templates') {
    for (const t of listTemplates()) console.log(t)
    return
  }

  if (cmd === 'mock-server') {
    const port = Number(argValue(rest, '--port') ?? 4099)
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
    if (process.env.TARGET_BASE_URL && !argValue(rest, '--base-url')) {
      // keep scenario value unless it still contains unresolved empty expand
      if (!scenario.target.baseUrl || scenario.target.baseUrl.includes('${')) {
        scenario.target.baseUrl = process.env.TARGET_BASE_URL
      }
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
      const failed = results.filter((r) => !r.ok).slice(0, 5)
      for (const f of failed) {
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
