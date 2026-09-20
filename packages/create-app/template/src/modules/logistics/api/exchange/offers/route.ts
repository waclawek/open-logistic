import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { listOpenOffers } from '../../../lib/exchange'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['logistics.view'] },
}

export async function GET() {
  const items = listOpenOffers()
  return Response.json({ items, total: items.length })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'LogisticsExchange',
  methods: {
    GET: {
      summary: 'List open exchange offers ready to accept',
      tags: ['Logistics'],
      responses: [{ status: 200, description: 'Offers', schema: z.object({ items: z.array(z.record(z.string(), z.unknown())), total: z.number() }) }],
    },
  },
}
