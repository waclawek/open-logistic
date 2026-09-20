import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { acceptOffer } from '../../../lib/exchange'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['logistics.view'] },
}

const bodySchema = z.object({
  offerId: z.string().min(1),
})

export async function POST(req: Request) {
  const json = await req.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 })
  }
  try {
    const result = acceptOffer(parsed.data.offerId)
    // Mirror accept into inbox for agent/debug feed
    try {
      await fetch(new URL(`/api/integrations/${result.offer.provider}/webhooks/offer-accept`, req.url).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Trans-Sim': '1' },
        body: JSON.stringify({
          event: 'offer.accepted',
          occurred_at: new Date().toISOString(),
          source: result.offer.provider,
          payload: result,
        }),
      })
    } catch {
      /* best-effort */
    }
    return Response.json(result)
  } catch (err) {
    return Response.json(
      { error: 'accept_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 404 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'LogisticsExchange',
  methods: {
    POST: {
      summary: 'Accept an exchange offer / quote',
      tags: ['Logistics'],
      responses: [{ status: 200, description: 'Accepted', schema: z.record(z.string(), z.unknown()) }],
    },
  },
}
