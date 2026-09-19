import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import { findOp } from './catalog'
import { deepMerge, generateBody, TEMPLATE_DEFAULT_OPS } from './generators'
import { createRateLimiter, mapPool, sendRequest } from './http'
import { deepExpandEnv } from './interpolate'
import type {
  BatchDefinition,
  CatalogOp,
  PreparedRequest,
  RequestResult,
  RunStats,
  Scenario,
} from './types'

function fillPath(template: string, params: Record<string, string | number>, index: number): string {
  return template.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    if (Object.prototype.hasOwnProperty.call(params, name)) return String(params[name])
    if (name === 'id' || name === 'orderId' || name === 'uuid' || name === 'costId' || name === 'publicOfferId' || name === 'freightQuoteId') {
      return String(params[name] ?? params.id ?? params.publicOfferId ?? `TC${1_000_000 + index}`)
    }
    return '0'
  })
}

function tokenValue(raw: string | number, index: number, seqBase: number): string {
  const s = String(raw)
  return s
    .replaceAll('$index', String(index))
    .replaceAll('$seq', String(seqBase + index))
    .replaceAll('$uuid', randomUUID())
}

export function prepareBatchRequests(
  scenario: Scenario,
  batch: BatchDefinition,
  catalog: CatalogOp[],
  seqBase = 0,
): PreparedRequest[] {
  const template = batch.template
  const opKey =
    batch.operation ??
    (template ? TEMPLATE_DEFAULT_OPS[template] : undefined) ??
    (() => {
      throw new Error(`[internal] Batch "${batch.id}" needs operation or template`)
    })()

  let catalogOp: CatalogOp | undefined
  try {
    catalogOp = findOp(catalog, opKey)
  } catch {
    // Custom / webhook-only ops are allowed when pathMap covers them.
    catalogOp = undefined
  }

  const method = (catalogOp?.method ?? (opKey.split(' ')[0] as PreparedRequest['method'])) || 'POST'
  const transPath = catalogOp?.path ?? opKey.replace(/^[A-Z]+\s+/, '')
  const mapKey = `${method} ${transPath}`
  const mapped =
    scenario.target.pathMap?.[mapKey] ??
    scenario.target.pathMap?.[opKey] ??
    (scenario.target.passthrough ? transPath : undefined)

  if (!mapped && !scenario.target.passthrough) {
    throw new Error(
      `[internal] No pathMap for "${mapKey}". Add target.pathMap or set target.passthrough: true`,
    )
  }

  const destPath = mapped ?? transPath
  const baseHeaders = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'open-mercato-trans-api-simulator/0.1',
    ...(scenario.target.headers ?? {}),
    ...(batch.headers ?? {}),
  }

  const out: PreparedRequest[] = []
  for (let i = 0; i < batch.count; i++) {
    const pathParams: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(batch.pathParams ?? {})) {
      pathParams[k] = tokenValue(v, i, seqBase)
    }
    const filledPath = fillPath(destPath, pathParams, i)
    const url = new URL(filledPath.replace(/^\//, ''), scenario.target.baseUrl.replace(/\/?$/, '/'))
    for (const [k, v] of Object.entries(batch.query ?? {})) {
      url.searchParams.set(k, tokenValue(String(v), i, seqBase))
    }

    const ctx = {
      index: i,
      batchId: batch.id,
      vars: batch.vars as Record<string, unknown> | undefined,
    }
    const generated = generateBody(template, ctx)
    const body = deepMerge(generated, batch.body)

    out.push({
      batchId: batch.id,
      index: i,
      method,
      url: url.toString(),
      headers: { ...baseHeaders },
      body: method === 'GET' || method === 'DELETE' ? undefined : body,
      operationKey: mapKey,
      template,
    })
  }
  return out
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[idx]
}

export function summarize(scenario: Scenario, run: number, results: RequestResult[]): RunStats {
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b)
  const byStatus: Record<string, number> = {}
  const byBatch: Record<string, { ok: number; failed: number }> = {}
  let ok = 0
  for (const r of results) {
    byStatus[String(r.status)] = (byStatus[String(r.status)] ?? 0) + 1
    byBatch[r.batchId] ??= { ok: 0, failed: 0 }
    if (r.ok) {
      ok++
      byBatch[r.batchId].ok++
    } else {
      byBatch[r.batchId].failed++
    }
  }
  return {
    scenario: scenario.name,
    run,
    startedAt: '',
    finishedAt: new Date().toISOString(),
    total: results.length,
    ok,
    failed: results.length - ok,
    avgMs: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0,
    p95Ms: Math.round(percentile(durations, 95)),
    byStatus,
    byBatch,
  }
}

export async function runScenarioOnce(
  scenario: Scenario,
  catalog: CatalogOp[],
  runIndex = 1,
): Promise<{ results: RequestResult[]; stats: RunStats }> {
  const startedAt = new Date().toISOString()
  const defaults = scenario.defaults ?? {}
  const dryRun = Boolean(defaults.dryRun)
  const timeoutMs = defaults.timeoutMs ?? 15_000
  const retries = defaults.retries ?? 0
  const retryBackoffMs = defaults.retryBackoffMs ?? 250
  const globalLimit = createRateLimiter(defaults.rps)

  const runBatch = async (batch: BatchDefinition, seqBase: number) => {
    const reqs = prepareBatchRequests(scenario, batch, catalog, seqBase)
    const concurrency = batch.concurrency ?? defaults.concurrency ?? 10
    const limit = batch.rps ? createRateLimiter(batch.rps) : globalLimit
    return mapPool(
      reqs,
      concurrency,
      async (req) => {
        await limit()
        return sendRequest(req, { timeoutMs, dryRun, retries, retryBackoffMs })
      },
      batch.staggerMs ?? 0,
    )
  }

  let results: RequestResult[] = []
  if (scenario.parallelBatches) {
    const nested = await Promise.all(
      scenario.batches.map((batch, idx) =>
        runBatch(batch, idx * Math.max(...scenario.batches.map((b) => b.count), 1)),
      ),
    )
    results = nested.flat()
  } else {
    let seq = 0
    for (const batch of scenario.batches) {
      const part = await runBatch(batch, seq)
      results = results.concat(part)
      seq += batch.count
    }
  }

  const stats = summarize(scenario, runIndex, results)
  stats.startedAt = startedAt

  if (scenario.reportPath) {
    const reportPath = path.resolve(scenario.reportPath)
    fs.mkdirSync(path.dirname(reportPath), { recursive: true })
    const lines = [
      JSON.stringify({ type: 'stats', ...stats }),
      ...results.map((r) => JSON.stringify({ type: 'result', ...r })),
    ]
    fs.writeFileSync(reportPath, `${lines.join('\n')}\n`)
  }

  return { results, stats }
}

export function loadScenarioFile(filePath: string): Scenario {
  const abs = path.resolve(filePath)
  const raw = fs.readFileSync(abs, 'utf8')
  const parsed = deepExpandEnv(parseYaml(raw)) as Scenario
  if (!parsed?.name || !parsed?.target?.baseUrl || !Array.isArray(parsed.batches)) {
    throw new Error(`[internal] Invalid scenario file: ${abs}`)
  }
  return parsed
}
