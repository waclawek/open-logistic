import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { searchFreeVehicles } from '../../../lib/exchange'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['logistics.view'] },
}

const bodySchema = z.object({
  locality: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  radiusKm: z.number().positive().optional(),
})

export async function POST(req: Request) {
  const json = await req.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 })
  }
  if (!parsed.data.locality && (parsed.data.lat == null || parsed.data.lng == null)) {
    return Response.json(
      { error: 'need_locality_or_coords', message: 'Provide locality and/or lat+lng' },
      { status: 400 },
    )
  }
  const items = searchFreeVehicles(parsed.data)
  return Response.json({ items, total: items.length, query: parsed.data })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'LogisticsExchange',
  methods: {
    POST: {
      summary: 'Search free vehicles near a locality',
      tags: ['Logistics'],
      responses: [{ status: 200, description: 'Vehicles', schema: z.object({ items: z.array(z.record(z.string(), z.unknown())), total: z.number() }) }],
    },
  },
}
