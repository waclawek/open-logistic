import type { PreparedRequest, RequestResult } from './types'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function sendRequest(
  req: PreparedRequest,
  opts: { timeoutMs: number; dryRun: boolean; retries: number; retryBackoffMs: number },
): Promise<RequestResult> {
  const started = Date.now()
  if (opts.dryRun) {
    return {
      batchId: req.batchId,
      index: req.index,
      operationKey: req.operationKey,
      method: req.method,
      url: req.url,
      ok: true,
      status: 0,
      durationMs: Date.now() - started,
      responsePreview: '[dry-run]',
    }
  }

  let lastError = ''
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
    try {
      const res = await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: controller.signal,
      })
      const text = await res.text()
      clearTimeout(timer)
      return {
        batchId: req.batchId,
        index: req.index,
        operationKey: req.operationKey,
        method: req.method,
        url: req.url,
        ok: res.ok,
        status: res.status,
        durationMs: Date.now() - started,
        responsePreview: text.slice(0, 400),
        error: res.ok ? undefined : text.slice(0, 400),
      }
    } catch (err) {
      clearTimeout(timer)
      lastError = err instanceof Error ? err.message : String(err)
      if (attempt < opts.retries) {
        await sleep(opts.retryBackoffMs * (attempt + 1))
        continue
      }
    }
  }

  return {
    batchId: req.batchId,
    index: req.index,
    operationKey: req.operationKey,
    method: req.method,
    url: req.url,
    ok: false,
    status: 0,
    durationMs: Date.now() - started,
    error: lastError,
  }
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  staggerMs = 0,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      if (staggerMs > 0) await sleep(i * staggerMs)
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

/** Token-bucket style limiter (~rps). */
export function createRateLimiter(rps?: number) {
  if (!rps || rps <= 0) {
    return async () => undefined
  }
  const interval = 1000 / rps
  let nextAt = Date.now()
  let chain: Promise<void> = Promise.resolve()
  return () => {
    chain = chain.then(async () => {
      const now = Date.now()
      const wait = Math.max(0, nextAt - now)
      nextAt = Math.max(nextAt, now) + interval
      if (wait > 0) await sleep(wait)
    })
    return chain
  }
}
