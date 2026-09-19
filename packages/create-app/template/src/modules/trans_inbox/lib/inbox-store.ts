import { randomUUID } from 'node:crypto'
import type { InboxScope } from '../data/validators'

export type TransInboxRequest = InboxScope & {
  id: string
  receivedAt: string
  source: string
  channel: string
  method: string
  path: string
  status: number
  headers: Record<string, string>
  query: Record<string, unknown>
  body: unknown
  contentType: string
  bytes: number
}

export const MAX_ITEMS = 100
export const MAX_SCOPES = 8
const RETENTION_MS = 60 * 60 * 1000
const STORE_KEY = '__openMercatoScopedTransInboxStore__'
type Store = Map<string, TransInboxRequest[]>

function getStore(): Store {
  const globals = globalThis as Record<string, unknown>
  if (!(globals[STORE_KEY] instanceof Map)) globals[STORE_KEY] = new Map<string, TransInboxRequest[]>()
  return globals[STORE_KEY] as Store
}

function scopeKey(scope: InboxScope): string {
  return JSON.stringify([scope.tenantId, scope.organizationId])
}

export function redactSecrets(value: unknown, token = '', depth = 0): unknown {
  if (depth > 16) return '[truncated]'
  if (typeof value === 'string') return token ? value.replaceAll(token, '[redacted]') : value
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, token, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /authorization|password|secret|token|signature|api.?key|cookie/i.test(key)
        ? '[redacted]'
        : redactSecrets(item, token, depth + 1),
    ]))
  }
  return value
}

export function sanitizeHeaders(headers: Headers): Record<string, string> {
  const allowed = ['content-type', 'user-agent', 'x-request-id', 'x-trans-sim', 'x-timocom-sim', 'x-eurodebt-sim']
  return Object.fromEntries(allowed.flatMap((key) => {
    const value = headers.get(key)
    return value ? [[key, value.slice(0, 256)]] : []
  }))
}

export function pushInboxRequest(input: Omit<TransInboxRequest, 'id' | 'receivedAt'>, token = ''): TransInboxRequest {
  const item = {
    ...input,
    headers: redactSecrets(input.headers, token) as Record<string, string>,
    query: redactSecrets(input.query, token) as Record<string, unknown>,
    body: redactSecrets(input.body, token),
    id: randomUUID(),
    receivedAt: new Date().toISOString(),
  }
  const store = getStore()
  const key = scopeKey(item)
  const previous = listInboxRequests(item)
  store.delete(key)
  store.set(key, [item, ...previous].slice(0, MAX_ITEMS))
  while (store.size > MAX_SCOPES) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
  return item
}

export function listInboxRequests(scope: InboxScope, limit = MAX_ITEMS): TransInboxRequest[] {
  const store = getStore()
  const key = scopeKey(scope)
  const cutoff = Date.now() - RETENTION_MS
  const items = (store.get(key) ?? []).filter((item) => Date.parse(item.receivedAt) > cutoff)
  if (items.length) store.set(key, items)
  else store.delete(key)
  const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(MAX_ITEMS, Math.trunc(limit))) : MAX_ITEMS
  return items.slice(0, bounded)
}
