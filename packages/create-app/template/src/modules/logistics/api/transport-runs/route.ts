import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  clearTransportRuns,
  hydrateTransportRunRoutes,
  listTransportRuns,
  startTransportRunFromAgreedOffer,
  toTransportRunView,
} from '../../lib/transport-run'
import { seedAgreedOffer } from '../../lib/agreed-offer'
import { resolveLogisticsRequestContext } from '../../lib/request-context'
import { logisticsResponse } from '../response'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['logistics.view'] },
  POST: { requireAuth: true, requireFeatures: ['logistics.view'] },
  DELETE: { requireAuth: true, requireFeatures: ['logistics.view'] },
}

export async function GET(req: Request) {
  return logisticsResponse(async () => {
    const { scope } = await resolveLogisticsRequestContext(req)
    const url = new URL(req.url)
    const limit = Number(url.searchParams.get('limit') || 20)
    const runs = listTransportRuns(limit, scope)
    await hydrateTransportRunRoutes(runs)
    const items = runs.map(toTransportRunView)
    return Response.json({ items, total: items.length })
  })
}

const postSchema = z.object({
  action: z.enum(['start-from-agreed-offer', 'seed-demo']).default('seed-demo'),
})

export async function POST(req: Request) {
  return logisticsResponse(async () => {
    const { scope } = await resolveLogisticsRequestContext(req)
    try {
      const body = await readJsonSafe(req, {})
      const parsed = postSchema.safeParse(body)
      if (!parsed.success) {
        return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
      }
      const offer = seedAgreedOffer()
      const run = await startTransportRunFromAgreedOffer({ offer, withOrder: true, scope })
      return Response.json(
        {
          run: toTransportRunView(run),
          agentHint:
            'logistics.carrier_finder: search vehicles OR publish listing, then propose_carrier. Wait for human approve. Then start_delivery + logistics.load_optimizer.',
        },
        { status: 201 },
      )
    } catch (err) {
      return Response.json(
        { error: 'start_failed', message: err instanceof Error ? err.message : String(err) },
        { status: 502 },
      )
    }
  })
}

export async function DELETE(req: Request) {
  return logisticsResponse(async () => {
    const { scope } = await resolveLogisticsRequestContext(req)
    const cleared = clearTransportRuns(scope)
    return Response.json({ ok: true, cleared })
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'LogisticsTransportRuns',
  methods: {
    GET: {
      summary: 'List transport orchestration runs (carrier → HITL → delivery → load optimizer)',
      tags: ['Logistics'],
    },
    POST: {
      summary: 'Start run from agreed client offer (offer_automation payload shape)',
      tags: ['Logistics'],
    },
  },
}
