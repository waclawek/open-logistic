import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { agentToolCatalog } from '../../../lib/exchange'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['logistics.view'] },
}

export async function GET() {
  return Response.json(agentToolCatalog())
}

export const openApi: OpenApiRouteDoc = {
  tag: 'LogisticsExchange',
  methods: {
    GET: {
      summary: 'Agent tool catalog for logistics exchange operations',
      tags: ['Logistics'],
      responses: [{ status: 200, description: 'Catalog', schema: z.record(z.string(), z.unknown()) }],
    },
  },
}
