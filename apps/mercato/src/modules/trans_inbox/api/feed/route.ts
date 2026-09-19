import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { emitTransInboxEvent } from '../../events'
import { clearInboxRequests, listInboxRequests } from '../../lib/inbox-store'

const logger = createLogger('trans_inbox').child({ component: 'feed' })

export const metadata = {
  GET: {
    requireAuth: true,
    requireFeatures: ['trans_inbox.view'],
  },
  DELETE: {
    requireAuth: true,
    requireFeatures: ['trans_inbox.manage'],
  },
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const limitRaw = Number(url.searchParams.get('limit') ?? 100)
  const limit = Number.isFinite(limitRaw) ? limitRaw : 100
  const items = listInboxRequests(limit)
  return Response.json({
    items,
    total: items.length,
    max: 300,
    broadcastTenantConfigured: Boolean(process.env.TRANS_INBOX_TENANT_ID?.trim()),
  })
}

export async function DELETE(req: Request) {
  const cleared = clearInboxRequests()
  const url = new URL(req.url)
  const tenantId =
    req.headers.get('x-om-tenant-id')?.trim() ||
    process.env.TRANS_INBOX_TENANT_ID?.trim() ||
    url.searchParams.get('tenantId')?.trim() ||
    null
  const organizationId =
    process.env.TRANS_INBOX_ORGANIZATION_ID?.trim() || null

  if (tenantId) {
    try {
      await emitTransInboxEvent('trans_inbox.feed.cleared', {
        tenantId,
        organizationId,
        cleared,
      })
    } catch (err) {
      logger.warn('Failed to broadcast clear event', { err })
    }
  }

  return Response.json({ ok: true, cleared })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'TransInbox',
  methods: {
    GET: {
      summary: 'List recent Trans simulator requests',
      tags: ['TransInbox'],
      responses: [
        {
          status: 200,
          description: 'Recent captured requests (newest first)',
          schema: z.object({
            items: z.array(z.record(z.string(), z.unknown())),
            total: z.number(),
            max: z.number(),
            broadcastTenantConfigured: z.boolean(),
          }),
        },
      ],
    },
    DELETE: {
      summary: 'Clear the in-memory Trans inbox',
      tags: ['TransInbox'],
      responses: [
        {
          status: 200,
          description: 'Inbox cleared',
          schema: z.object({ ok: z.literal(true), cleared: z.number() }),
        },
      ],
    },
  },
}
