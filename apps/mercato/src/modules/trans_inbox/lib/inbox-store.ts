import { randomUUID } from 'node:crypto'

export type TransInboxRequest = {
  id: string
  receivedAt: string
  /** Marketplace source: trans | timocom */
  source: string
  channel: string
  method: string
  path: string
  status: number
  headers: Record<string, string>
  query: Record<string, string>
  body: unknown
  bodyPreview: string
  contentType: string | null
  bytes: number
  tenantId: string | null
  organizationId: string | null
  clientIp: string | null
}

const STORE_KEY = '__openMercatoTransInboxStore__'
const MAX_ITEMS = 300

type Store = {
  items: TransInboxRequest[]
}

function getStore(): Store {
  const scope = globalThis as Record<string, unknown>
  const existing = scope[STORE_KEY]
  if (existing && typeof existing === 'object' && Array.isArray((existing as Store).items)) {
    return existing as Store
  }
  const created: Store = { items: [] }
  scope[STORE_KEY] = created
  return created
}

const HEADER_ALLOWLIST = new Set([
  'content-type',
  'user-agent',
  'authorization',
  'x-trans-sim',
  'x-timocom-sim',
  'x-om-tenant-id',
  'x-om-organization-id',
  'x-request-id',
])

export function sanitizeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (!HEADER_ALLOWLIST.has(lower)) return
    if (lower === 'authorization') {
      out[key] = value.toLowerCase().startsWith('basic ') || value.toLowerCase().startsWith('bearer ')
        ? `${value.split(' ')[0]} ***`
        : '***'
      return
    }
    out[key] = value
  })
  return out
}

export function resolveBroadcastScope(headers: Headers): {
  tenantId: string | null
  organizationId: string | null
} {
  const tenantId =
    headers.get('x-om-tenant-id')?.trim() ||
    process.env.TRANS_INBOX_TENANT_ID?.trim() ||
    null
  const organizationId =
    headers.get('x-om-organization-id')?.trim() ||
    process.env.TRANS_INBOX_ORGANIZATION_ID?.trim() ||
    null
  return { tenantId, organizationId }
}

export function pushInboxRequest(
  partial: Omit<TransInboxRequest, 'id' | 'receivedAt' | 'bodyPreview' | 'source'> & {
    source?: string
    bodyPreview?: string
  },
): TransInboxRequest {
  const bodyPreview =
    partial.bodyPreview ??
    (typeof partial.body === 'string'
      ? partial.body.slice(0, 2000)
      : JSON.stringify(partial.body ?? null).slice(0, 2000))

  const item: TransInboxRequest = {
    ...partial,
    source: partial.source ?? 'trans',
    id: randomUUID(),
    receivedAt: new Date().toISOString(),
    bodyPreview,
  }
  const store = getStore()
  store.items.unshift(item)
  if (store.items.length > MAX_ITEMS) {
    store.items.length = MAX_ITEMS
  }
  return item
}

export function listInboxRequests(limit = 100): TransInboxRequest[] {
  const n = Math.min(Math.max(limit, 1), MAX_ITEMS)
  return getStore().items.slice(0, n)
}

export function clearInboxRequests(): number {
  const store = getStore()
  const cleared = store.items.length
  store.items = []
  return cleared
}

export function parseBody(raw: string, contentType: string | null): unknown {
  if (!raw) return null
  if (contentType?.includes('application/json')) {
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return raw
    }
  }
  return raw
}
