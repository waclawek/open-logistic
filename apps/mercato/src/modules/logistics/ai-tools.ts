/**
 * Read-only AI tool pack for the logistics module.
 *
 * The agent proposes, the system decides: every number here comes from the
 * deterministic helpers in `lib/` (geo, pricing, backhaul), never from the model.
 */
import { z } from 'zod'
import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import type { AiToolDefinition, McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { estimateRoute } from './lib/geo'
import { priceJob } from './lib/pricing'
import { findBackhaulProposals } from './lib/backhaul'
import { loadCarriers, loadTransportJobs, loadVehicles, type LogisticsScope } from './lib/jobs'

const HOME_BASE = 'Wrocław'

export function requireToolScope(context: Pick<McpToolContext, 'tenantId' | 'organizationId'>): LogisticsScope {
  const tenantId = typeof context.tenantId === 'string' ? context.tenantId.trim() : ''
  const organizationId = typeof context.organizationId === 'string' ? context.organizationId.trim() : ''
  if (!tenantId || !organizationId) {
    throw new Error('[internal] logistics AI tools require a tenant- and organization-scoped context')
  }
  return { tenantId, organizationId }
}

const estimateRouteInput = z.object({
  from: z.string().min(2).describe('Pickup address or city, e.g. "ul. Fabryczna 12, Wrocław"'),
  to: z.string().min(2).describe('Delivery address or city, e.g. "Berlin"'),
})

const estimateRouteTool: AiToolDefinition = defineAiTool<unknown, ReturnType<typeof estimateRoute>>({
  name: 'logistics.estimate_route',
  displayName: 'Logistyka — szacuj trasę',
  description:
    'Estimate road distance (km) and driving time (hours) between two addresses or cities. Deterministic gazetteer + haversine with a road factor; `known: false` means a city was not recognised and 500 km was assumed.',
  tags: ['read', 'logistics'],
  isMutation: false,
  requiredFeatures: ['logistics.view'],
  inputSchema: estimateRouteInput,
  async handler(rawInput) {
    const input = estimateRouteInput.parse(rawInput)
    return estimateRoute(input.from, input.to)
  },
})

const priceJobInput = z.object({
  from: z.string().min(2).describe('Pickup address or city'),
  to: z.string().min(2).describe('Delivery address or city'),
  pallets: z.number().int().positive().optional().describe('Number of EUR pallets'),
  weightKg: z.number().positive().optional().describe('Cargo weight in kg'),
  clientPrice: z.number().positive().optional().describe('Price the client offered or accepted (PLN net). Omit to get a suggested quote.'),
  maxCarrierCost: z.number().positive().optional().describe('Ceiling for buying the transport from a subcontractor (PLN).'),
})

const priceJobTool: AiToolDefinition = defineAiTool<unknown, ReturnType<typeof priceJob>>({
  name: 'logistics.price_job',
  displayName: 'Logistyka — wyceń zlecenie',
  description:
    'Price a transport job: own-fleet cost and margin, offers from every subcontractor on file (rate × km), the best safe carrier, a suggested client price when none is given, and a deterministic recommendation (own_fleet | subcontractor | negotiate | human_review) with a Polish rationale. Uses live vehicle availability and carrier profiles from this organization.',
  tags: ['read', 'logistics', 'pricing'],
  isMutation: false,
  requiredFeatures: ['logistics.view'],
  inputSchema: priceJobInput,
  async handler(rawInput, context) {
    const input = priceJobInput.parse(rawInput)
    const scope = requireToolScope(context)
    const [carriers, vehicles] = await Promise.all([
      loadCarriers(context.container, scope),
      loadVehicles(context.container, scope),
    ])
    return priceJob({ ...input, carriers, vehicles })
  },
})

const listJobsInput = z.object({
  onlyUnassigned: z.boolean().optional().describe('Return only jobs with dispatch_mode = unassigned'),
})

const listTransportJobsTool: AiToolDefinition = defineAiTool<unknown, { jobs: unknown[]; total: number }>({
  name: 'logistics.list_transport_jobs',
  displayName: 'Logistyka — lista zleceń',
  description:
    'List transport jobs (sales orders carrying pickup/delivery/cargo fields) for the current organization with client, route, pickup window, cargo, client price and current dispatch status.',
  tags: ['read', 'logistics'],
  isMutation: false,
  requiredFeatures: ['logistics.view'],
  inputSchema: listJobsInput,
  async handler(rawInput, context) {
    const input = listJobsInput.parse(rawInput ?? {})
    const scope = requireToolScope(context)
    const jobs = await loadTransportJobs(context.container, scope)
    const filtered = input.onlyUnassigned ? jobs.filter((job) => job.dispatchMode === 'unassigned') : jobs
    return { jobs: filtered, total: filtered.length }
  },
})

const findBackhaulInput = z.object({
  orderId: z.string().uuid().optional().describe('Restrict to proposals that include this order id'),
})

const findBackhaulTool: AiToolDefinition = defineAiTool<unknown, { proposals: unknown[]; homeBase: string }>({
  name: 'logistics.find_backhaul',
  displayName: 'Logistyka — ładunek powrotny',
  description:
    'Find pairs of transport jobs that one truck can run back-to-back so it does not return empty: connector distance, kilometres and PLN saved versus two separate trips, combined margin, and whether the pickup windows make it feasible.',
  tags: ['read', 'logistics', 'planning'],
  isMutation: false,
  requiredFeatures: ['logistics.view'],
  inputSchema: findBackhaulInput,
  async handler(rawInput, context) {
    const input = findBackhaulInput.parse(rawInput ?? {})
    const scope = requireToolScope(context)
    const jobs = await loadTransportJobs(context.container, scope)
    let proposals = findBackhaulProposals(jobs, HOME_BASE)
    if (input.orderId) {
      proposals = proposals.filter((p) => p.first.id === input.orderId || p.second.id === input.orderId)
    }
    return { proposals, homeBase: HOME_BASE }
  },
})

export const aiTools: AiToolDefinition[] = [estimateRouteTool, priceJobTool, listTransportJobsTool, findBackhaulTool]
export default aiTools
