import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getClientIp } from '@open-mercato/shared/lib/ratelimit/helpers'
import { emitTransInboxEvent } from '../../../../../events'
import {
  parseBody,
  pushInboxRequest,
  resolveBroadcastScope,
  sanitizeHeaders,
} from '../../../../../lib/inbox-store'

const logger = createLogger('trans_inbox').child({ component: 'webhook' })

const PROVIDERS = new Set(['trans', 'timocom', 'eurodebt'])

export const metadata = {
  path: '/integrations/[provider]/webhooks/[channel]',
  POST: {
    requireAuth: false,
    rateLimit: { points: 120, duration: 60, keyPrefix: 'trans_inbox:webhook' },
  },
}

async function handle(req: Request, provider: string, channel: string) {
  const raw = await req.text()
  const contentType = req.headers.get('content-type')
  const url = new URL(req.url)
  const query: Record<string, string> = {}
  url.searchParams.forEach((value, key) => {
    query[key] = value
  })
  const scope = resolveBroadcastScope(req.headers)
  const body = parseBody(raw, contentType)

  const item = pushInboxRequest({
    source: provider,
    channel,
    method: 'POST',
    path: url.pathname,
    status: 202,
    headers: sanitizeHeaders(req.headers),
    query,
    body,
    contentType,
    bytes: Buffer.byteLength(raw, 'utf8'),
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    clientIp: getClientIp(req),
  })

  if (scope.tenantId) {
    try {
      await emitTransInboxEvent('trans_inbox.request.received', {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        request: item,
      })
    } catch (err) {
      logger.warn('Failed to broadcast inbox event', {
        err,
        requestId: item.id,
      })
    }
  }

  return Response.json(
    {
      ok: true,
      id: item.id,
      provider,
      channel,
      receivedAt: item.receivedAt,
      broadcast: Boolean(scope.tenantId),
    },
    { status: 202 },
  )
}

export async function POST(
  req: Request,
  ctx: {
    params: Promise<{ provider: string; channel: string }> | { provider: string; channel: string }
  },
) {
  const params = await ctx.params
  const provider = (params.provider || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '')
  const channel = (params.channel || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '')
  if (!PROVIDERS.has(provider)) {
    return Response.json(
      {
        error: 'unsupported_provider',
        message: `Supported providers: ${[...PROVIDERS].join(', ')}`,
      },
      { status: 404 },
    )
  }
  return handle(req, provider || 'unknown', channel || 'unknown')
}

export const openApi: OpenApiRouteDoc = {
  tag: 'TransInbox',
  methods: {
    POST: {
      summary: 'Accept Trans.eu, TIMOCOM, or Eurodebt simulator webhook payload',
      tags: ['TransInbox'],
      responses: [
        {
          status: 202,
          description: 'Captured into the live inbox',
          schema: z.object({
            ok: z.literal(true),
            id: z.string().uuid(),
            provider: z.string(),
            channel: z.string(),
            receivedAt: z.string(),
            broadcast: z.boolean(),
          }),
        },
      ],
    },
  },
}
