import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  clearOrders,
  createOrder,
  createWawPozDemo,
  listOrders,
  stopsFromInboxBody,
} from '../../lib/orders-store'
import { listInboxRequests } from '../../../trans_inbox/lib/inbox-store'

export const metadata = {
  GET: {
    requireAuth: true,
    requireFeatures: ['logistics.view'],
  },
  POST: {
    requireAuth: true,
    requireFeatures: ['logistics.view'],
  },
  DELETE: {
    requireAuth: true,
    requireFeatures: ['logistics.view'],
  },
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const limit = Number(url.searchParams.get('limit') ?? 50)
  const items = listOrders(Number.isFinite(limit) ? limit : 50)
  return Response.json({ items, total: items.length })
}

const postSchema = z.object({
  action: z.enum(['demo-waw-poz', 'from-inbox', 'create']).default('demo-waw-poz'),
  notes: z.string().optional(),
  inboxRequestId: z.string().uuid().optional(),
})

export async function POST(req: Request) {
  const json = await req.json().catch(() => ({}))
  const parsed = postSchema.safeParse(json)
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 })
  }

  try {
    if (parsed.data.action === 'demo-waw-poz') {
      const order = await createWawPozDemo(parsed.data.notes)
      // Mirror into Trans inbox so the live feed shows the same job
      try {
        await fetch(
          new URL('/api/integrations/trans/webhooks/order', req.url).toString(),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Trans-Sim': '1',
              'X-Om-Tenant-Id': process.env.TRANS_INBOX_TENANT_ID || '',
            },
            body: JSON.stringify({
              event: 'order.created',
              occurred_at: new Date().toISOString(),
              source: 'logistics.demo',
              payload: {
                external_id: order.id,
                reference_number: order.referenceNumber,
                status: 'new',
                notes: order.notes,
                stops: order.stops.map((s) => ({
                  role: s.role,
                  name: s.name,
                  country: s.country,
                  locality: s.locality,
                  postal_code: s.postalCode,
                  street: s.street,
                  number: s.number,
                  coordinates: { latitude: s.lat, longitude: s.lng },
                })),
                route_hint: {
                  from: { name: order.stops[0].name, lat: order.stops[0].lat, lng: order.stops[0].lng },
                  to: {
                    name: order.stops[order.stops.length - 1].name,
                    lat: order.stops[order.stops.length - 1].lat,
                    lng: order.stops[order.stops.length - 1].lng,
                  },
                  profile: 'car',
                },
                route: order.route
                  ? {
                      distance_m: order.route.distanceM,
                      time_ms: order.route.timeMs,
                      source: order.route.source,
                      provider: order.route.provider,
                    }
                  : null,
              },
            }),
          },
        )
      } catch {
        // inbox mirror is best-effort
      }
      return Response.json({ order }, { status: 201 })
    }

    if (parsed.data.action === 'from-inbox') {
      const feed = listInboxRequests(100)
      const match = parsed.data.inboxRequestId
        ? feed.find((i) => i.id === parsed.data.inboxRequestId)
        : feed.find((i) => i.channel === 'order' || i.channel === 'freight')
      if (!match) {
        return Response.json(
          { error: 'inbox_empty', message: 'No order/freight in Trans inbox. Run yarn trans:sim … waw-poz-order.yaml' },
          { status: 404 },
        )
      }
      const stops = stopsFromInboxBody(match.body)
      if (!stops) {
        return Response.json(
          { error: 'no_stops', message: 'Inbox payload has no geocoded stops', inboxRequestId: match.id },
          { status: 422 },
        )
      }
      const order = await createOrder({
        stops,
        source: 'inbox',
        inboxRequestId: match.id,
        rawPayload: match.body,
        notes: `Imported from inbox ${match.source}/${match.channel}`,
        withRoute: true,
      })
      return Response.json({ order }, { status: 201 })
    }

    return Response.json({ error: 'unsupported_action' }, { status: 400 })
  } catch (err) {
    return Response.json(
      { error: 'order_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    )
  }
}

export async function DELETE() {
  const cleared = clearOrders()
  return Response.json({ ok: true, cleared })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'LogisticsOrders',
  methods: {
    GET: {
      summary: 'List in-memory logistics transport orders',
      tags: ['Logistics'],
      responses: [{ status: 200, description: 'Orders', schema: z.object({ items: z.array(z.record(z.string(), z.unknown())), total: z.number() }) }],
    },
    POST: {
      summary: 'Create demo WAW→POZ order (GraphHopper) or import from Trans inbox',
      tags: ['Logistics'],
      responses: [{ status: 201, description: 'Created', schema: z.object({ order: z.record(z.string(), z.unknown()) }) }],
    },
  },
}
