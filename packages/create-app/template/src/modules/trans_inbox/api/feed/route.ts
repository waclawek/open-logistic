import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { feedQuerySchema } from '../../data/validators'
import { resolveInboxConfig } from '../../lib/config'
import { inboxError } from '../../lib/errors'
import { listInboxRequests, MAX_ITEMS } from '../../lib/inbox-store'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['trans_inbox.view'] },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return inboxError(401, 'unauthorized')
  if (!auth.tenantId) return inboxError(403, 'scopeRequired')
  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  if (scope.selectionRejected) return inboxError(403, 'scopeRequired')
  const tenantId = scope.tenantId ?? auth.tenantId
  const organizationId = scope.selectedId
  if (!organizationId) return organizationScopeRequiredResponse()
  if (scope.filterIds && !scope.filterIds.includes(organizationId)) return inboxError(403, 'scopeRequired')
  const query = feedQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!query.success) return inboxError(400, 'invalidQuery')
  const config = resolveInboxConfig()
  const enabled = Boolean(config && config.tenantId === tenantId && config.organizationId === organizationId)
  const items = enabled ? listInboxRequests({ tenantId, organizationId }, query.data.limit) : []
  return Response.json({ items, total: items.length, max: MAX_ITEMS, enabled }, { headers: { 'Cache-Control': 'no-store' } })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'TransInbox',
  methods: {
    GET: {
      summary: 'List scoped development simulator requests',
      responses: [{
        status: 200,
        description: 'Recent sanitized diagnostic requests from the authenticated organization',
        schema: z.object({
          items: z.array(z.record(z.string(), z.unknown())),
          total: z.number(),
          max: z.number(),
          enabled: z.boolean(),
        }),
      }],
    },
  },
}
