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
    'RateLimit-Limit': '100',
    'RateLimit-Remaining': '99',
    'RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
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
  return Object.entries(TEMPLATE_DEFAULT_OPS).find(([, key]) => key === op.key)?.[0]
}

function mongoId(): string {
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
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
      json(res, 200, {
        ok: true,
        ops: catalog.length,
        templates: listTemplates(),
        provider: 'eurodebt',
      })
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
        error: { type: 'NOT_FOUND', message: `No Eurodebt mock route for ${method} ${url.pathname}` },
        hint: 'GET /__sim/catalog',
      })
      return
    }

    const template = templateForOp(hit)
    const requestId = mongoId()

    if (hit.path === '/api/v1.0/verification/submit' && method === 'POST') {
      json(res, 202, {
        requestId,
        status: 'pending',
        message: 'Verification request accepted',
      })
      return
    }

    if (hit.path.startsWith('/api/v1.0/verification/request') && method === 'GET') {
      json(res, 200, {
        requestId: url.pathname.split('/').pop(),
        status: 'completed',
        verificationId: 10_000 + seq++,
        type: 'company',
        countryCode: 'PL',
        vatNumber: '1234567890',
        companyName: 'Mock Company Sp. z o.o.',
        dateCreated: new Date(Date.now() - 3600_000).toISOString(),
        dateCompleted: new Date().toISOString(),
      })
      return
    }

    if (hit.path.includes('/verification/report') && method === 'GET') {
      json(res, 200, {
        id: Number(url.pathname.split('/').filter(Boolean).pop()) || seq++,
        type: 'company',
        countryCode: 'PL',
        vatNumber: '1234567890',
        companyName: 'Mock Company Sp. z o.o.',
        status: 'completed',
      })
      return
    }

    if (hit.path === '/api/v1.0/usage' && method === 'GET') {
      json(res, 200, {
        period: 'current',
        requestsUsed: seq,
        requestsLimit: 1000,
        creditsRemaining: 500,
      })
      return
    }

    if (method === 'POST' && hit.path.includes('/pdf')) {
      json(res, 202, { status: 'pending', message: 'PDF generation queued' })
      return
    }

    json(res, 200, {
      ok: true,
      operation: hit.key,
      echo: template
        ? generateBody(template, { index: seq++, batchId: 'mock-server' })
        : null,
    })
  })

  server.listen(port, '127.0.0.1', () => {
    console.log(`[mock-server] Eurodebt API mock on http://127.0.0.1:${port}`)
    console.log(`[mock-server] base path prefix: /api/v1.0`)
    console.log(`[mock-server] health: http://127.0.0.1:${port}/__sim/health`)
    console.log(`[mock-server] catalog: ${catalog.length} ops`)
  })

  return server
}

export function assertKnownOp(catalog: CatalogOp[], key: string) {
  return findOp(catalog, key)
}
