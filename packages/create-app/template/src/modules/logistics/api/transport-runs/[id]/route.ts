import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  advanceTruck,
  approveBackloadProposal,
  approveCarrierProposal,
  getTransportRun,
  proposeBackload,
  proposeCarrier,
  publishListingForRun,
  rejectBackloadProposal,
  rejectCarrierProposal,
  scanBackloadsAlongRun,
  searchVehiclesForRun,
  startDelivery,
  toTransportRunView,
  updateBackloadScanProgress,
  DEMO_TRIP_STEP_PCT,
  emptyBackloadScanForReset,
} from '../../../lib/transport-run'
import { resolveLogisticsRequestContext } from '../../../lib/request-context'
import { logisticsResponse } from '../../response'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['logistics.view'] },
  POST: { requireAuth: true, requireFeatures: ['logistics.view'] },
}

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  return logisticsResponse(async () => {
    const { scope } = await resolveLogisticsRequestContext(req)
    const { id } = await ctx.params
    const run = getTransportRun(id, scope)
    if (!run) return Response.json({ error: 'not_found' }, { status: 404 })
    return Response.json({ run: toTransportRunView(run) })
  })
}

const postSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('search-vehicles'), locality: z.string().optional(), radiusKm: z.number().optional() }),
  z.object({
    action: z.literal('publish-listing'),
    title: z.string().min(8),
    body: z.string().min(40),
  }),
  z.object({
    action: z.literal('propose-carrier'),
    source: z.enum(['active_vehicle_search', 'passive_listing', 'exchange_offer']),
    vehicleId: z.string().optional(),
    offerId: z.string().optional(),
    summary: z.string().optional(),
    priceEur: z.number().optional(),
    rationale: z.string().min(20),
  }),
  z.object({ action: z.literal('approve-carrier'), approvedBy: z.string().optional() }),
  z.object({ action: z.literal('reject-carrier'), reason: z.string().optional() }),
  z.object({ action: z.literal('start-delivery') }),
  z.object({
    action: z.literal('advance'),
    stepPct: z.number().min(0.1).max(50).optional(),
  }),
  z.object({
    action: z.literal('scan-backloads'),
    force: z.boolean().optional(),
    radiusKm: z.number().min(5).max(120).optional(),
  }),
  z.object({
    action: z.literal('scan-progress'),
    progressPct: z.number().min(0).max(100),
  }),
  z.object({ action: z.literal('reset-backload-scan') }),
  z.object({
    action: z.literal('propose-backload'),
    candidateId: z.string(),
    evaluation: z.string().min(30),
  }),
  z.object({ action: z.literal('approve-backload'), approvedBy: z.string().optional() }),
  z.object({ action: z.literal('reject-backload'), reason: z.string().optional() }),
])

export async function POST(req: Request, ctx: Ctx) {
  return logisticsResponse(async () => {
    const { scope } = await resolveLogisticsRequestContext(req)
    const { id } = await ctx.params
    if (!getTransportRun(id, scope)) return Response.json({ error: 'not_found' }, { status: 404 })

    try {
      const body = await readJsonSafe(req, {})
      const parsed = postSchema.safeParse(body)
      if (!parsed.success) {
        return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
      }
      const a = parsed.data

      switch (a.action) {
        case 'search-vehicles':
          return Response.json({ run: toTransportRunView(searchVehiclesForRun(id, a.locality, a.radiusKm)) })
        case 'publish-listing':
          return Response.json({
            run: toTransportRunView(publishListingForRun(id, { title: a.title, body: a.body })),
          })
        case 'propose-carrier':
          return Response.json({
            run: toTransportRunView(
              proposeCarrier(id, {
                source: a.source,
                vehicleId: a.vehicleId,
                offerId: a.offerId,
                summary: a.summary,
                priceEur: a.priceEur,
                rationale: a.rationale,
              }),
            ),
            humanGate: 'carrier_proposal_pending — human2 must approve',
          })
        case 'approve-carrier':
          return Response.json({
            run: toTransportRunView(approveCarrierProposal(id, a.approvedBy ?? 'human2')),
          })
        case 'reject-carrier':
          return Response.json({
            run: toTransportRunView(rejectCarrierProposal(id, a.reason)),
          })
        case 'start-delivery':
          return Response.json({ run: toTransportRunView(startDelivery(id)) })
        case 'advance': {
          const result = advanceTruck(id, a.stepPct ?? DEMO_TRIP_STEP_PCT)
          return Response.json({
            run: toTransportRunView(result.run),
            position: result.position,
          })
        }
        case 'scan-backloads': {
          const result = scanBackloadsAlongRun(id, { force: a.force, radiusKm: a.radiusKm })
          return Response.json({
            run: toTransportRunView(result.run),
            aheadCandidates: result.aheadCandidates,
          })
        }
        case 'scan-progress':
          return Response.json({
            run: toTransportRunView(updateBackloadScanProgress(id, a.progressPct)),
          })
        case 'reset-backload-scan':
          return Response.json({ run: toTransportRunView(emptyBackloadScanForReset(id)) })
        case 'propose-backload':
          return Response.json({
            run: toTransportRunView(proposeBackload(id, a.candidateId, a.evaluation)),
            humanGate: 'backload_proposal_pending — human2 must approve',
          })
        case 'approve-backload':
          return Response.json({
            run: toTransportRunView(approveBackloadProposal(id, a.approvedBy ?? 'human2')),
          })
        case 'reject-backload':
          return Response.json({
            run: toTransportRunView(rejectBackloadProposal(id, a.reason)),
          })
        default:
          return Response.json({ error: 'unsupported_action' }, { status: 400 })
      }
    } catch (err) {
      return Response.json(
        { error: 'action_failed', message: err instanceof Error ? err.message : String(err) },
        { status: 422 },
      )
    }
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'LogisticsTransportRuns',
  methods: {
    GET: { summary: 'Get one transport run', tags: ['Logistics'] },
    POST: { summary: 'Advance transport run (agent / HITL actions)', tags: ['Logistics'] },
  },
}
