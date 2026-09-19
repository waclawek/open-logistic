import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { CatalogOp, HttpMethod } from './types'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const PATH_PREFIX = '/freight-exchange/3'

export function resolveDocsRoot(cwd = process.cwd()): string {
  const candidates = [
    path.resolve(cwd, 'timocom_api_doc'),
    path.resolve(cwd, '../timocom_api_doc'),
    path.resolve(cwd, '../../timocom_api_doc'),
    path.resolve(__dirname, '../../../timocom_api_doc'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error(`[internal] timocom_api_doc not found from ${cwd}`)
}

export function loadCatalog(docsRoot?: string): CatalogOp[] {
  const root = docsRoot ?? resolveDocsRoot()
  const file = path.join(root, 'freight-exchange-openapi.yaml')
  if (!fs.existsSync(file)) {
    throw new Error(`[internal] Missing ${file}`)
  }
  const doc = parseYaml(fs.readFileSync(file, 'utf8')) as {
    paths?: Record<string, Record<string, unknown>>
  }
  const ops: CatalogOp[] = []
  for (const [p, item] of Object.entries(doc.paths ?? {})) {
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
      const fullPath = p.startsWith(PATH_PREFIX) ? p : `${PATH_PREFIX}${p}`
      ops.push({
        key: `${method} ${fullPath}`,
        method,
        path: fullPath,
        operationId: op.operationId,
        summary: op.summary || op.description,
        api: 'freight-exchange',
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
