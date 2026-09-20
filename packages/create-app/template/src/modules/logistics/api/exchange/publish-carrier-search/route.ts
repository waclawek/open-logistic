import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { publishCarrierSearch } from '../../../lib/exchange'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['logistics.view'] },
}

const pointSchema = z.object({
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
})

const bodySchema = z.object({
  from: pointSchema,
  to: pointSchema,
  weightT: z.number().positive().optional(),
  priceHint: z.object({ amount: z.number(), currency: z.string() }).optional(),
  provider: z.enum(['trans', 'timocom']).optional(),
  reference: z.string().optional(),
  title: z.string().min(8),
  body: z.string().min(40),
})

export async function POST(req: Request) {
  const json = await req.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 })
  }
  const listing = publishCarrierSearch(parsed.data)
  try {
    const channel = listing.provider === 'timocom' ? 'freight-offer' : 'freight'
    await fetch(new URL(`/api/integrations/${listing.provider}/webhooks/${channel}`, req.url).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Om-Sim': '1' },
      body: JSON.stringify({
        event: 'carrier_search.published',
        lookingFor: 'carrier',
        occurred_at: listing.publishedAt,
        source: listing.provider,
        payload: listing,
      }),
    })
  } catch {
    /* best-effort */
  }
  return Response.json({ listing }, { status: 201 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'LogisticsExchange',
  methods: {
    POST: {
      summary: 'Publish looking-for-carrier listing on the exchange',
      tags: ['Logistics'],
      responses: [{ status: 201, description: 'Published', schema: z.object({ listing: z.record(z.string(), z.unknown()) }) }],
    },
  },
}
