import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { ensureOrderRoute, searchBackloadsAlongRoute } from '../../../lib/exchange'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['logistics.view'] },
}

const bodySchema = z.object({
  orderId: z.string().uuid().optional(),
  radiusKm: z.number().positive().optional(),
  maxResults: z.number().int().positive().max(50).optional(),
  ensureRoute: z.boolean().optional(),
  costPerKmEur: z.number().positive().optional(),
  minNetEurHint: z.number().optional(),
  /** Truck position along route (km) — only return freights at/ahead of this point. */
  fromAlongKm: z.number().min(0).optional(),
})

export async function POST(req: Request) {
  const json = await req.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 })
  }
  try {
    if (parsed.data.orderId && parsed.data.ensureRoute !== false) {
      await ensureOrderRoute(parsed.data.orderId)
    }
    const result = searchBackloadsAlongRoute({
      orderId: parsed.data.orderId,
      radiusKm: parsed.data.radiusKm,
      maxResults: parsed.data.maxResults,
      costPerKmEur: parsed.data.costPerKmEur,
      minNetEurHint: parsed.data.minNetEurHint,
      fromAlongKm: parsed.data.fromAlongKm,
    })
    return Response.json(result)
  } catch (err) {
    return Response.json(
      { error: 'backload_search_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'LogisticsExchange',
  methods: {
    POST: {
      summary: 'Search doładunki / backloads along a GraphHopper route for a logistics order',
      tags: ['Logistics'],
      responses: [{ status: 200, description: 'Ranked candidates', schema: z.record(z.string(), z.unknown()) }],
    },
  },
}
