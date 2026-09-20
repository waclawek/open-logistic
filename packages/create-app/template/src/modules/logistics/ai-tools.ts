/**
 * Logistics AI tools — carrier finder + load optimizer.
 *
 * HITL mirrors offer_automation: agent proposes, human gates on
 * `/backend/logistics/proposals-disruptions` (not auto-executed).
 */
import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import type { AiToolDefinition } from '@open-mercato/ai-assistant/types'
import { z } from 'zod'
import {
  advanceTruckAndScanBackloads,
  approveBackloadProposal,
  approveCarrierProposal,
  getTransportRun,
  listTransportRuns,
  proposeBackload,
  proposeCarrier,
  publishListingForRun,
  rejectBackloadProposal,
  rejectCarrierProposal,
  scanBackloadsAlongRun,
  searchVehiclesForRun,
  startDelivery,
  startTransportRunFromAgreedOffer,
} from './lib/transport-run'
import { seedAgreedOffer } from './lib/agreed-offer'
import { listOpenOffers } from './lib/exchange'

const FEATURES = ['logistics.view'] as const

type ToolScopeContext = {
  tenantId?: string | null
  organizationId?: string | null
}

function toolScope(ctx: ToolScopeContext) {
  if (!ctx.tenantId || !ctx.organizationId) {
    throw new Error('[internal] Logistics AI tool requires tenant and organization scope')
  }
  return { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
}

function assertScopedRun(runId: string, ctx: ToolScopeContext): void {
  if (!getTransportRun(runId, toolScope(ctx))) {
    throw new Error(`[internal] Transport run ${runId} not found`)
  }
}

function defineLogisticsTool<TSchema extends z.ZodType, TOutput>(
  tool: Omit<AiToolDefinition<z.output<TSchema>, TOutput>, 'inputSchema'> & {
    inputSchema: TSchema
  },
): AiToolDefinition<z.output<TSchema>, TOutput> {
  return defineAiTool<z.output<TSchema>, TOutput>({
    ...tool,
    inputSchema: tool.inputSchema as z.ZodType<z.output<TSchema>>,
  })
}

const startFromAgreedOffer = defineLogisticsTool({
  name: 'logistics.start_from_agreed_offer',
  displayName: 'Start from agreed offer',
  description:
    'Load the agreed client offer (offer_automation / orderPayloadSchema shape) and create a transport run + GraphHopper order. Call this first.',
  isMutation: false,
  requiredFeatures: [...FEATURES],
  inputSchema: z.object({}),
  async handler(_args, ctx) {
    const offer = seedAgreedOffer()
    const run = await startTransportRunFromAgreedOffer({
      offer,
      withOrder: true,
      scope: toolScope(ctx),
    })
    return {
      runId: run.id,
      status: run.status,
      orderId: run.orderId,
      agreedOffer: {
        offerId: offer.offerId,
        customerName: offer.customerName,
        quoteNetEur: offer.quoteNetEur,
        currencyCode: offer.currencyCode,
        customerReference: offer.customerReference,
        lineItems: offer.lineItems,
        lane: offer.lane,
        notes: offer.notes,
      },
      next: 'Call logistics.search_vehicles_for_run AND/OR logistics.publish_carrier_listing, then logistics.propose_carrier.',
    }
  },
})

const listRuns = defineLogisticsTool({
  name: 'logistics.list_transport_runs',
  displayName: 'List transport runs',
  description: 'List recent transport orchestration runs and their HITL status.',
  isMutation: false,
  requiredFeatures: [...FEATURES],
  inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
  async handler(args, ctx) {
    const items = listTransportRuns(args.limit, toolScope(ctx)).map((r) => ({
      id: r.id,
      status: r.status,
      customer: r.agreedOffer.customerName,
      quoteNetEur: r.agreedOffer.quoteNetEur,
      orderId: r.orderId,
      hasCarrierProposal: Boolean(r.carrierProposal),
      hasBackloadProposal: Boolean(r.backloadProposal),
      progressPct: r.truck?.progressPct ?? null,
    }))
    return { items, total: items.length }
  },
})

const getRun = defineLogisticsTool({
  name: 'logistics.get_transport_run',
  displayName: 'Get transport run',
  description: 'Full snapshot of a transport run including agreed offer, proposals, truck position.',
  isMutation: false,
  requiredFeatures: [...FEATURES],
  inputSchema: z.object({ runId: z.string().uuid() }),
  async handler(args, ctx) {
    const run = getTransportRun(args.runId, toolScope(ctx))
    if (!run) throw new Error(`Transport run ${args.runId} not found`)
    return { run }
  },
})

const searchVehicles = defineLogisticsTool({
  name: 'logistics.search_vehicles_for_run',
  displayName: 'Search free vehicles (active)',
  description: 'ACTIVE path: search mock exchange free vehicles near the corridor midpoint.',
  isMutation: false,
  requiredFeatures: [...FEATURES],
  inputSchema: z.object({
    runId: z.string().uuid(),
    locality: z.string().optional(),
    radiusKm: z.number().optional(),
  }),
  async handler(args, ctx) {
    assertScopedRun(args.runId, ctx)
    const run = searchVehiclesForRun(args.runId, args.locality, args.radiusKm)
    return {
      runId: run.id,
      status: run.status,
      vehicleHits: run.vehicleHits,
      next: 'Call logistics.propose_carrier with source=active_vehicle_search and a vehicleId.',
    }
  },
})

const publishListing = defineLogisticsTool({
  name: 'logistics.publish_carrier_listing',
  displayName: 'Publish carrier search (passive)',
  description:
    'PASSIVE path: YOU write the ogłoszenie (title + body) and publish it on the mock exchange for this run’s lane. Title ≥8 chars, body ≥40 chars — real freight-board copy.',
  isMutation: false,
  requiredFeatures: [...FEATURES],
  inputSchema: z.object({
    runId: z.string().uuid(),
    title: z.string().min(8).describe('Headline for the carrier-search listing'),
    body: z.string().min(40).describe('Full ogłoszenie: lane, weight, windows, requirements, contact ask'),
  }),
  async handler(args, ctx) {
    assertScopedRun(args.runId, ctx)
    const run = publishListingForRun(args.runId, {
      title: args.title,
      body: args.body,
    })
    return {
      runId: run.id,
      listing: run.listing,
      next: 'Also search vehicles (active). Then propose_carrier with a written rationale.',
    }
  },
})

const listExchangeOffers = defineLogisticsTool({
  name: 'logistics.list_exchange_offers',
  displayName: 'List exchange offers',
  description: 'Scan open mock exchange freight offers/quotes (third carrier-search source).',
  isMutation: false,
  requiredFeatures: [...FEATURES],
  inputSchema: z.object({}),
  async handler() {
    return { items: listOpenOffers() }
  },
})

const proposeCarrierTool = defineLogisticsTool({
  name: 'logistics.propose_carrier',
  displayName: 'Propose carrier (HITL)',
  description:
    'Propose a carrier after scanning. MUST include Polish rationale (why this vehicle/listing). Does NOT auto-approve — STOP for human2.',
  isMutation: false,
  requiredFeatures: [...FEATURES],
  inputSchema: z.object({
    runId: z.string().uuid(),
    source: z.enum(['active_vehicle_search', 'passive_listing', 'exchange_offer']),
    vehicleId: z.string().optional(),
    offerId: z.string().optional(),
    summary: z.string().optional(),
    priceEur: z.number().optional(),
    rationale: z
      .string()
      .min(20)
      .describe(
        '1–2 krótkie zdania PO POLSKU dla dyspozytora: dlaczego ten przewoźnik (lokalizacja, pojemność, cena). Bez bulletów.',
      ),
  }),
  async handler(args, ctx) {
    assertScopedRun(args.runId, ctx)
    const run = proposeCarrier(args.runId, args)
    return {
      runId: run.id,
      status: run.status,
      carrierProposal: run.carrierProposal,
      humanGate: {
        required: true,
        role: 'human2',
        page: '/backend/logistics/proposals-disruptions',
        actions: ['approve-carrier', 'reject-carrier'],
      },
      instruction: 'STOP. Wait for human approval before start_delivery.',
    }
  },
})

const approveCarrierTool = defineLogisticsTool({
  name: 'logistics.approve_carrier',
  displayName: 'Approve carrier (human2)',
  description: 'Human-in-the-loop: approve pending carrier proposal and unlock delivery.',
  isMutation: false,
  requiredFeatures: [...FEATURES],
  inputSchema: z.object({
    runId: z.string().uuid(),
    approvedBy: z.string().default('human2'),
  }),
  async handler(args, ctx) {
    assertScopedRun(args.runId, ctx)
    const run = approveCarrierProposal(args.runId, args.approvedBy)
    return {
      runId: run.id,
      status: run.status,
      approvedCarrier: run.approvedCarrier,
    }
  },
})

const rejectCarrierTool = defineLogisticsTool({
  name: 'logistics.reject_carrier',
  displayName: 'Reject carrier (human2)',
  description: 'Human-in-the-loop: reject pending carrier proposal; carrier finder can search again.',
  isMutation: false,
  requiredFeatures: [...FEATURES],
  inputSchema: z.object({
    runId: z.string().uuid(),
    reason: z.string().optional(),
  }),
  async handler(args, ctx) {
    assertScopedRun(args.runId, ctx)
    const run = rejectCarrierProposal(args.runId, args.reason)
    return { runId: run.id, status: run.status }
  },
})

const startDeliveryTool = defineLogisticsTool({
  name: 'logistics.start_delivery',
  displayName: 'Start delivery',
  description: 'After carrier approved: place truck at origin on GraphHopper route and begin in_transit.',
  isMutation: false,
  requiredFeatures: [...FEATURES],
  inputSchema: z.object({ runId: z.string().uuid() }),
  async handler(args, ctx) {
    assertScopedRun(args.runId, ctx)
    const run = startDelivery(args.runId)
    return {
      runId: run.id,
      status: run.status,
      truck: run.truck,
      next: 'Hand off to load optimizer: logistics.scan_backloads_along_route once (UI monitors the truck).',
    }
  },
})

const scanBackloads = defineLogisticsTool({
  name: 'logistics.scan_backloads_along_route',
  displayName: 'Scan backloads along route',
  description:
    'Search doładunki once from the truck position FORWARD along the GraphHopper corridor (never behind). Truck motion is separate. Pass force=true only on operator retry.',
  isMutation: false,
  requiredFeatures: [...FEATURES],
  inputSchema: z.object({
    runId: z.string().uuid(),
    force: z.boolean().optional(),
    radiusKm: z.number().min(5).max(120).optional(),
  }),
  async handler(args, ctx) {
    assertScopedRun(args.runId, ctx)
    const result = scanBackloadsAlongRun(args.runId, {
      force: args.force,
      radiusKm: args.radiusKm,
    })
    return {
      runId: result.run.id,
      status: result.run.status,
      backloadScan: result.run.backloadScan,
      aheadCandidates: result.aheadCandidates.map((c) => ({
        id: c.id,
        provider: c.provider,
        alongRouteKm: c.alongRouteKm,
        detourKmEstimate: c.detourKmEstimate,
        weightT: c.weightT,
        price: c.price,
        summary: c.summary,
        economics: c.economics,
      })),
      next:
        result.aheadCandidates.length > 0
          ? 'Wybierz najlepszy netEur + fitsFreeCapacity i wołaj logistics.propose_backload (uzasadnienie po polsku).'
          : 'Brak sensownych frachtów przed ciężarówką — stop (operator może ponowić skan).',
    }
  },
})

const advanceAndScan = defineLogisticsTool({
  name: 'logistics.advance_truck_and_scan_backloads',
  displayName: 'Advance truck + scan ahead (legacy)',
  description:
    'Legacy: move truck along GH polyline then scan. Prefer logistics.scan_backloads_along_route; the UI advances the truck.',
  isMutation: false,
  requiredFeatures: [...FEATURES],
  inputSchema: z.object({
    runId: z.string().uuid(),
    stepPct: z.number().min(0.1).max(50).default(12),
  }),
  async handler(args, ctx) {
    assertScopedRun(args.runId, ctx)
    const result = advanceTruckAndScanBackloads(args.runId, args.stepPct)
    return {
      runId: result.run.id,
      status: result.run.status,
      position: result.position,
      aheadCandidates: result.aheadCandidates.map((c) => ({
        id: c.id,
        provider: c.provider,
        alongRouteKm: c.alongRouteKm,
        detourKmEstimate: c.detourKmEstimate,
        weightT: c.weightT,
        price: c.price,
        summary: c.summary,
        economics: c.economics,
      })),
      acceptedBackloads: result.run.acceptedBackloads.length,
      next:
        result.aheadCandidates.length > 0
          ? 'Wybierz najlepszy netEur + fitsFreeCapacity i wołaj logistics.propose_backload (uzasadnienie po polsku).'
          : 'Brak sensownych frachtów przed ciężarówką — stop lub poczekaj na retry operatora.',
    }
  },
})

const proposeBackloadTool = defineLogisticsTool({
  name: 'logistics.propose_backload',
  displayName: 'Propose backload (HITL)',
  description:
    'Propose a doładunek ahead of the truck after evaluating candidates. MUST include Polish evaluation (netEur, fee, capacity). STOP for human2.',
  isMutation: false,
  requiredFeatures: [...FEATURES],
  inputSchema: z.object({
    runId: z.string().uuid(),
    candidateId: z.string(),
    evaluation: z
      .string()
      .min(30)
      .describe(
        '1–2 krótkie zdania PO POLSKU dla dyspozytora: netEur, prowizja, dopasowanie pojemności. Tylko ładunki przed ciężarówką. Bez bulletów.',
      ),
  }),
  async handler(args, ctx) {
    assertScopedRun(args.runId, ctx)
    const run = proposeBackload(args.runId, args.candidateId, args.evaluation)
    return {
      runId: run.id,
      status: run.status,
      backloadProposal: run.backloadProposal,
      humanGate: {
        required: true,
        role: 'human2',
        page: '/backend/logistics/proposals-disruptions',
        actions: ['approve-backload', 'reject-backload'],
      },
      instruction: 'STOP. Wait for human approval before advancing further.',
    }
  },
})

const approveBackloadTool = defineLogisticsTool({
  name: 'logistics.approve_backload',
  displayName: 'Approve backload (human2)',
  description: 'Human-in-the-loop: accept proposed doładunek; updates free capacity & commercials.',
  isMutation: false,
  requiredFeatures: [...FEATURES],
  inputSchema: z.object({
    runId: z.string().uuid(),
    approvedBy: z.string().default('human2'),
  }),
  async handler(args, ctx) {
    assertScopedRun(args.runId, ctx)
    const run = approveBackloadProposal(args.runId, args.approvedBy)
    return {
      runId: run.id,
      status: run.status,
      acceptedBackloads: run.acceptedBackloads.length,
    }
  },
})

const rejectBackloadTool = defineLogisticsTool({
  name: 'logistics.reject_backload',
  displayName: 'Reject backload (human2)',
  description: 'Human-in-the-loop: reject proposed doładunek; truck continues.',
  isMutation: false,
  requiredFeatures: [...FEATURES],
  inputSchema: z.object({
    runId: z.string().uuid(),
    reason: z.string().optional(),
  }),
  async handler(args, ctx) {
    assertScopedRun(args.runId, ctx)
    const run = rejectBackloadProposal(args.runId, args.reason)
    return { runId: run.id, status: run.status }
  },
})

export const aiTools = [
  startFromAgreedOffer,
  listRuns,
  getRun,
  searchVehicles,
  publishListing,
  listExchangeOffers,
  proposeCarrierTool,
  approveCarrierTool,
  rejectCarrierTool,
  startDeliveryTool,
  scanBackloads,
  advanceAndScan,
  proposeBackloadTool,
  approveBackloadTool,
  rejectBackloadTool,
]

export default aiTools
