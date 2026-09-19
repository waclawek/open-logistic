import fs from 'node:fs'
import path from 'node:path'
import type { CatalogOp, HttpMethod } from './types'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const PATH_PREFIX = '/api/v1.0'

type OpenApiDoc = {
  paths?: Record<string, Record<string, unknown>>
  webhooks?: Record<string, Record<string, unknown>>
}

export function resolveDocsRoot(cwd = process.cwd()): string {
  const candidates = [
    path.resolve(cwd, 'eurodebt_api_doc'),
    path.resolve(cwd, '../eurodebt_api_doc'),
    path.resolve(cwd, '../../eurodebt_api_doc'),
    path.resolve(__dirname, '../../../eurodebt_api_doc'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error(`[internal] eurodebt_api_doc not found from ${cwd}`)
}

function pushOps(
  ops: CatalogOp[],
  paths: Record<string, Record<string, unknown>> | undefined,
  api: string,
  pathPrefix = '',
) {
  for (const [p, item] of Object.entries(paths ?? {})) {
    for (const method of METHODS) {
      const lower = method.toLowerCase()
      const op = item[lower] as
        | {
            operationId?: string
            summary?: string
            description?: string
            requestBody?: unknown
          }
        | undefined
      if (!op) continue
      const fullPath = p.startsWith('/') ? `${pathPrefix}${p}` : `${pathPrefix}/${p}`
      ops.push({
        key: `${method} ${fullPath}`,
        method,
        path: fullPath,
        operationId: op.operationId,
        summary: op.summary || op.description,
        api,
        hasBody: Boolean(op.requestBody),
      })
    }
  }
}

export function loadCatalog(docsRoot?: string): CatalogOp[] {
  const root = docsRoot ?? resolveDocsRoot()
  const file = path.join(root, 'openapi.json')
  if (!fs.existsSync(file)) {
    throw new Error(`[internal] Missing ${file}`)
  }
  const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as OpenApiDoc
  const ops: CatalogOp[] = []
  pushOps(ops, doc.paths, 'eurodebt', PATH_PREFIX)
  // Webhooks are outbound from Eurodebt → our sink; expose as synthetic POST ops.
  if (doc.webhooks) {
    for (const [name, item] of Object.entries(doc.webhooks)) {
      const op = item.post as
        | {
            operationId?: string
            summary?: string
            description?: string
            requestBody?: unknown
          }
        | undefined
      if (!op) continue
      const fullPath = `/webhooks/${name}`
      ops.push({
        key: `POST ${fullPath}`,
        method: 'POST',
        path: fullPath,
        operationId: op.operationId ?? name,
        summary: op.summary || op.description,
        api: 'eurodebt-webhook',
        hasBody: Boolean(op.requestBody),
      })
    }
  }
  return ops.sort((a, b) => a.key.localeCompare(b.key))
}

export function findOp(catalog: CatalogOp[], keyOrId: string): CatalogOp {
  const exact = catalog.find((op) => op.key === keyOrId)
  if (exact) return exact
  const byId = catalog.find((op) => op.operationId === keyOrId)
  if (byId) return byId
  const loose = catalog.filter(
    (op) =>
      op.key.toLowerCase().includes(keyOrId.toLowerCase()) ||
      (op.operationId?.toLowerCase().includes(keyOrId.toLowerCase()) ?? false),
  )
  if (loose.length === 1) return loose[0]
  if (loose.length > 1) {
    throw new Error(
      `[internal] Ambiguous operation "${keyOrId}". Matches:\n` +
        loose.slice(0, 12).map((o) => `  - ${o.key}`).join('\n'),
    )
  }
  throw new Error(`[internal] Unknown operation "${keyOrId}"`)
}
