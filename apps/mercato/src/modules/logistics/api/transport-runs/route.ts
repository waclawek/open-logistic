import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { LogisticsTransport } from '../../data/entities'
import {
  clearTransportRuns,
  hydrateTransportRunRoutes,
  listTransportRuns,
  startTransportRunFromAgreedOffer,
  toTransportRunView,
} from '../../lib/transport-run'
import { seedAgreedOffer } from '../../lib/agreed-offer'
import {
  isTransportReadyForDeliveryMonitoring,
  startTransportRunFromDispatcherTransport,
  toDispatcherTransportLike,
} from '../../lib/dispatcher-handoff'
import { logisticsError } from '../../lib/server-domain'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['logistics.view'] },
  POST: { requireAuth: true, requireFeatures: ['logistics.view'] },
  DELETE: { requireAuth: true, requireFeatures: ['logistics.view'] },
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const limit = Number(url.searchParams.get('limit') || 20)
  const runs = listTransportRuns(limit)
  await hydrateTransportRunRoutes(runs)
  const items = runs.map(toTransportRunView)
  return Response.json({ items, total: items.length })
}

const postSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('seed-demo') }),
  z.object({ action: z.literal('start-from-agreed-offer') }),
  z.object({ action: z.literal('start-from-dispatcher-transport'), transportId: z.uuid() }),
  z.object({ action: z.literal('sync-from-dispatcher') }),
])

async function resolveScope(req: Request) {
  const initialAuth = await getAuthFromRequest(req)
  if (!initialAuth?.tenantId) return logisticsError(401, 'unauthorized')
  const container = await createRequestContainer()
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth: initialAuth, request: req })
  if (organizationScope?.selectionRejected) return logisticsError(422, 'scopeRequired')
  const auth = { ...initialAuth, tenantId: organizationScope?.tenantId ?? initialAuth.tenantId }
  const organizationId = organizationScope?.selectedId ?? auth.orgId
  if (!organizationId) return logisticsError(400, 'scopeRequired')
  const em = container.resolve<EntityManager>('em').fork()
  return { em, scope: { tenantId: auth.tenantId, organizationId, deletedAt: null as null } }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const parsed = postSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
    }

    if (parsed.data.action === 'seed-demo' || parsed.data.action === 'start-from-agreed-offer') {
      const offer = seedAgreedOffer()
      const run = await startTransportRunFromAgreedOffer({ offer, withOrder: true })
      return Response.json(
        {
          run: toTransportRunView(run),
          agentHint:
            'logistics.carrier_finder: search vehicles OR publish listing, then propose_carrier. Wait for human approve. Then start_delivery + logistics.load_optimizer.',
        },
        { status: 201 },
      )
    }

    const { em, scope } = await resolveScope(req)

    if (parsed.data.action === 'start-from-dispatcher-transport') {
      const record = await findOneWithDecryption(
        em,
        LogisticsTransport,
        { ...scope, id: parsed.data.transportId },
        {},
        scope,
      )
      if (!record) return await logisticsError(404, 'notFound')
      const transport = toDispatcherTransportLike(record)
      if (!isTransportReadyForDeliveryMonitoring(transport)) {
        return Response.json(
          { error: 'transport_not_ready', message: 'Order 1 and Order 2 must both be confirmed' },
          { status: 409 },
        )
      }
      const { run, created } = await startTransportRunFromDispatcherTransport(transport)
      await hydrateTransportRunRoutes([run])
      return Response.json(
        {
          run: toTransportRunView(run),
          created,
          agentHint: 'Carrier already approved in AI Transports — monitoring delivery and scanning for backloads.',
        },
        { status: created ? 201 : 200 },
      )
    }

    // sync-from-dispatcher: hand off every fully accepted transport that is not yet in the inbox
    const records = await findWithDecryption(
      em,
      LogisticsTransport,
      { ...scope },
      { orderBy: { reference: 'asc' }, limit: 50 },
      scope,
    )
    const started = []
    for (const record of records) {
      const transport = toDispatcherTransportLike(record)
      if (!isTransportReadyForDeliveryMonitoring(transport)) continue
      const { run, created } = await startTransportRunFromDispatcherTransport(transport)
      if (created) started.push(toTransportRunView(run))
    }
    const runs = listTransportRuns(50)
    await hydrateTransportRunRoutes(runs)
    return Response.json({
      items: runs.map(toTransportRunView),
      started: started.length,
      total: runs.length,
    })
  } catch (err) {
    return Response.json(
      { error: 'start_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    )
  }
}

export async function DELETE() {
  const cleared = clearTransportRuns()
  return Response.json({ ok: true, cleared })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'LogisticsTransportRuns',
  methods: {
    GET: {
      summary: 'List transport orchestration runs (carrier → HITL → delivery → load optimizer)',
      tags: ['Logistics'],
    },
    POST: {
      summary: 'Start run from agreed offer, dispatcher transport, or sync all ready transports',
      tags: ['Logistics'],
    },
  },
}
