export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type ScenarioTarget = {
  /** Destination base URL (Open Mercato, proxy, or real Trans). */
  baseUrl: string
  /** Optional rewrite: Trans op key → local path. Key = "METHOD /ext/..." */
  pathMap?: Record<string, string>
  headers?: Record<string, string>
  /** When true, keep Trans `/ext/...` paths as-is on baseUrl. */
  passthrough?: boolean
}

export type ScenarioDefaults = {
  concurrency?: number
  /** Soft rate limit across the whole scenario run. */
  rps?: number
  timeoutMs?: number
  dryRun?: boolean
  retries?: number
  retryBackoffMs?: number
}

export type BatchDefinition = {
  id: string
  /** How many requests in this batch. */
  count: number
  concurrency?: number
  rps?: number
  /** Either a Trans operation key or a template that implies one. */
  operation?: string
  /** Named mock body generator, e.g. `freight.create.public`. */
  template?: string
  /** Static body (merged over template output). */
  body?: JsonValue
  /** Path params for `{id}` etc. Supports `$index`, `$uuid`, `$seq`. */
  pathParams?: Record<string, string | number>
  query?: Record<string, string | number | boolean>
  headers?: Record<string, string>
  vars?: Record<string, JsonValue>
  /** Delay between starting each request in the batch. */
  staggerMs?: number
  /** Weight for mixed random pick when using `pick`. */
  weight?: number
}

export type ScheduleDefinition =
  | { mode: 'once' }
  | { mode: 'interval'; everyMs?: number; every?: string | number; maxRuns?: number; until?: string }
  | { mode: 'cron'; expression: string; maxRuns?: number; until?: string }
  | { mode: 'at'; at: string }

export type Scenario = {
  name: string
  description?: string
  target: ScenarioTarget
  defaults?: ScenarioDefaults
  /** Ordered batches (run sequentially unless parallelBatches). */
  batches: BatchDefinition[]
  /** Run all batches concurrently instead of sequentially. */
  parallelBatches?: boolean
  schedule?: ScheduleDefinition
  /** Emit NDJSON result lines to this file. */
  reportPath?: string
}

export type CatalogOp = {
  key: string
  method: HttpMethod
  path: string
  operationId?: string
  summary?: string
  api: string
  hasBody: boolean
}

export type PreparedRequest = {
  batchId: string
  index: number
  method: HttpMethod
  url: string
  headers: Record<string, string>
  body?: unknown
  operationKey: string
  template?: string
}

export type RequestResult = {
  batchId: string
  index: number
  operationKey: string
  method: HttpMethod
  url: string
  ok: boolean
  status: number
  durationMs: number
  error?: string
  responsePreview?: string
}

export type RunStats = {
  scenario: string
  run: number
  startedAt: string
  finishedAt: string
  total: number
  ok: number
  failed: number
  avgMs: number
  p95Ms: number
  byStatus: Record<string, number>
  byBatch: Record<string, { ok: number; failed: number }>
}
