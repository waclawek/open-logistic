import http from 'node:http'
import { URL } from 'node:url'
import type { CatalogOp } from './types'
import { generateBody, TEMPLATE_DEFAULT_OPS, listTemplates } from './generators'
import { findOp } from './catalog'

function json(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(payload)
}

function matchPath(pattern: string, actual: string): Record<string, string> | null {
  const pp = pattern.split('/').filter(Boolean)
  const aa = actual.split('/').filter(Boolean)
  if (pp.length !== aa.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith('{') && pp[i].endsWith('}')) {
      params[pp[i].slice(1, -1)] = decodeURIComponent(aa[i])
      continue
    }
    if (pp[i] !== aa[i]) return null
  }
  return params
}

function templateForOp(op: CatalogOp): string | undefined {
  const entry = Object.entries(TEMPLATE_DEFAULT_OPS).find(([, key]) => key === op.key)
  return entry?.[0]
}

export function startMockServer(opts: {
  port: number
  catalog: CatalogOp[]
  latencyMs?: number
}): http.Server {
  const { port, catalog, latencyMs = 25 } = opts
  let seq = 1

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': '*',
      })
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    if (url.pathname === '/__sim/health') {
      json(res, 200, { ok: true, ops: catalog.length, templates: listTemplates() })
      return
    }
    if (url.pathname === '/__sim/catalog') {
      json(res, 200, catalog)
      return
    }

    const method = (req.method ?? 'GET').toUpperCase()
    const hit = catalog.find((op) => {
      if (op.method !== method) return false
      return matchPath(op.path, url.pathname) != null
    })

    await new Promise((r) => setTimeout(r, latencyMs))

    if (!hit) {
      json(res, 404, {
        error: 'not_found',
        message: `No Trans mock route for ${method} ${url.pathname}`,
        hint: 'GET /__sim/catalog',
      })
      return
    }

    const id = seq++
    const template = templateForOp(hit)
    const body =
      method === 'GET'
        ? Array.from({ length: 3 }, (_, i) =>
            generateBody(template ?? 'freight.create.public', {
              index: i,
              batchId: 'mock-server',
            }),
          )
        : {
            id,
            status: 'ok',
            mock: true,
            operation: hit.key,
            echo: template
              ? generateBody(template, { index: id, batchId: 'mock-server' })
              : null,
          }

    const status = method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200
    if (status === 204) {
      res.writeHead(204)
      res.end()
      return
    }
    json(res, status, body)
  })

  server.listen(port, '127.0.0.1', () => {
    console.log(`[mock-server] Trans.eu mock on http://127.0.0.1:${port}`)
    console.log(`[mock-server] health: http://127.0.0.1:${port}/__sim/health`)
    console.log(`[mock-server] catalog: ${catalog.length} ops`)
  })

  return server
}

export function assertKnownOp(catalog: CatalogOp[], key: string) {
  return findOp(catalog, key)
}
