import { randomUUID } from 'node:crypto'
import type { AgreedClientOffer } from './agreed-offer'
import { seedAgreedOffer } from './agreed-offer'
import type { BackloadCandidate, FreeVehicle, CarrierSearchListing } from './exchange'
import { listOpenOffers, publishCarrierSearch, searchFreeVehicles, searchBackloadsAlongRoute } from './exchange'
import { createOrder, getOrder, upgradeOrderRouteIfNeeded } from './orders-store'
import type { LogisticsOrder, LatLng } from './types'
import { deriveCapacity, deriveCommercials } from './types'
import {
  DEMO_BACKLOAD_RADIUS_KM,
  DEMO_STAGE_BUDGET_MS,
  DEMO_STAGE_RAMP_MS,
  DEMO_TRIP_DURATION_SEC,
  DEMO_TRIP_STEP_PCT,
  type AgentLogEntry,
  type BackloadScanState,
  type CarrierParty,
  type CarrierProposal,
  type CarrierSource,
  type HistoryEntry,
  type HistoryPayload,
  type TransportRun,
  type TransportRunStatus,
  type TransportRunView,
  type TruckPosition,
} from './transport-run-model'

export type {
  AgentLogEntry,
  BackloadProposal,
  BackloadScanState,
  CarrierParty,
  CarrierProposal,
  CarrierSource,
  HistoryEntry,
  HistoryPayload,
  TransportRun,
  TransportRunStatus,
  TransportRunView,
  TruckPosition,
} from './transport-run-model'

export {
  DEMO_BACKLOAD_RADIUS_KM,
  DEMO_STAGE_BUDGET_MS,
  DEMO_STAGE_RAMP_MS,
  DEMO_TRIP_DURATION_SEC,
  DEMO_TRIP_STEP_PCT,
  DEMO_TRIP_TICK_MS,
} from './transport-run-model'

const STORE_KEY = '__openMercatoLogisticsTransportRuns__'
const MAX = 50

type Store = { items: TransportRun[] }

export type TransportRunScope = {
  tenantId: string
  organizationId: string
}

function getStore(): Store {
  const scope = globalThis as Record<string, unknown>
  const existing = scope[STORE_KEY]
  if (existing && typeof existing === 'object' && Array.isArray((existing as Store).items)) {
    return existing as Store
  }
  const created: Store = { items: [] }
  scope[STORE_KEY] = created
  return created
}

function touch(run: TransportRun, event: string, detail?: string, payload?: HistoryPayload) {
  run.updatedAt = new Date().toISOString()
  run.history.unshift({
    at: run.updatedAt,
    event,
    detail,
    ...(payload ? { payload } : {}),
  })
  if (run.history.length > 40) run.history.length = 40
}

function enterStage(run: TransportRun, status: TransportRunStatus) {
  if (run.status !== status) {
    run.status = status
    run.stageEnteredAt = new Date().toISOString()
  }
}

function stageElapsedMs(run: TransportRun): number {
  const started = Date.parse(run.stageEnteredAt || run.updatedAt || run.createdAt)
  if (!Number.isFinite(started)) return 0
  return Math.max(0, Date.now() - started)
}

/** Rising chance after RAMP_MS; always true at BUDGET_MS so stages never hang. */
export function shouldEscalateAgentStage(elapsedMs: number, roll = Math.random()): boolean {
  if (elapsedMs >= DEMO_STAGE_BUDGET_MS) return true
  if (elapsedMs < DEMO_STAGE_RAMP_MS) return false
  const t = (elapsedMs - DEMO_STAGE_RAMP_MS) / (DEMO_STAGE_BUDGET_MS - DEMO_STAGE_RAMP_MS)
  // Quadratic ramp: early ticks mostly LLM, late ticks almost always force.
  return roll < t * t
}

function emptyBackloadScan(): BackloadScanState {
  return {
    status: 'idle',
    radiusKm: DEMO_BACKLOAD_RADIUS_KM,
    progressPct: 0,
    center: null,
    candidatesCount: 0,
    lastScanAt: null,
    aheadCandidateIds: [],
  }
}

/** Clear scan + pending proposal so load optimizer can search again. */
export function emptyBackloadScanForReset(runId: string): TransportRun {
  const run = requireRun(runId)
  run.backloadScan = emptyBackloadScan()
  run.backloadProposal = null
  if (run.status === 'backload_proposal_pending') enterStage(run, 'in_transit')
  else run.stageEnteredAt = new Date().toISOString()
  touch(run, 'backload_scan_reset', 'Operator requested another corridor search')
  return run
}

function capacitySnapshot(
  order: LogisticsOrder,
  jitter = false,
): Pick<TruckPosition, 'usedWeightT' | 'freeWeightT' | 'usedLdm' | 'freeLdm' | 'maxWeightT' | 'maxLdm'> {
  const cap = order.capacity
  // Tiny demo drift so the operator sees live capacity while the truck moves
  const driftW = jitter ? (Math.random() - 0.5) * 0.08 : 0
  const driftL = jitter ? (Math.random() - 0.5) * 0.04 : 0
  const usedWeightT = Math.max(0, Math.round((cap.usedWeightT + driftW) * 100) / 100)
  const usedLdm = Math.max(0, Math.round((cap.usedLdm + driftL) * 100) / 100)
  return {
    maxWeightT: cap.maxWeightT,
    maxLdm: cap.maxLdm,
    usedWeightT,
    usedLdm,
    freeWeightT: Math.max(0, Math.round((cap.maxWeightT - usedWeightT) * 100) / 100),
    freeLdm: Math.max(0, Math.round((cap.maxLdm - usedLdm) * 100) / 100),
  }
}

function pointAtProgress(coords: [number, number][], progressPct: number): { lat: number; lng: number } {
  const pct = Math.min(100, Math.max(0, progressPct))
  const idx = Math.min(coords.length - 1, Math.floor((pct / 100) * (coords.length - 1)))
  const [lng, lat] = coords[idx]!
  return { lat, lng }
}

export function listTransportRuns(limit = 20, scope?: TransportRunScope): TransportRun[] {
  const items = scope
    ? getStore().items.filter((run) => run.tenantId === scope.tenantId && run.organizationId === scope.organizationId)
    : getStore().items
  return items.slice(0, Math.min(Math.max(limit, 1), MAX))
}

export function getTransportRun(id: string, scope?: TransportRunScope): TransportRun | null {
  const run =
    getStore().items.find(
      (candidate) =>
        candidate.id === id &&
        (!scope || (candidate.tenantId === scope.tenantId && candidate.organizationId === scope.organizationId)),
    ) ?? null
  if (run && !run.stageEnteredAt) run.stageEnteredAt = run.updatedAt || run.createdAt
  return run
}

export function findTransportRunForSource(sourceTransportId: string, scope: TransportRunScope): TransportRun | null {
  return (
    getStore().items.find(
      (run) =>
        run.sourceTransportId === sourceTransportId &&
        run.tenantId === scope.tenantId &&
        run.organizationId === scope.organizationId,
    ) ?? null
  )
}

export function clearTransportRuns(scope?: TransportRunScope): number {
  const store = getStore()
  if (!scope) {
    const count = store.items.length
    store.items = []
    return count
  }
  const before = store.items.length
  store.items = store.items.filter(
    (run) => run.tenantId !== scope.tenantId || run.organizationId !== scope.organizationId,
  )
  return before - store.items.length
}

export async function startTransportRunFromAgreedOffer(input?: {
  offer?: AgreedClientOffer
  withOrder?: boolean
  scope?: TransportRunScope
  sourceTransportId?: string | null
}): Promise<TransportRun> {
  const agreedOffer = input?.offer ?? seedAgreedOffer()
  const scope = input?.scope ?? { tenantId: 'demo', organizationId: 'demo' }
  const sourceTransportId = input?.sourceTransportId ?? null
  if (sourceTransportId) {
    const existing = findTransportRunForSource(sourceTransportId, scope)
    if (existing) return existing
  }
  let orderId: string | null = null
  if (input?.withOrder !== false) {
    const order = await createOrder({
      stops: [
        {
          role: 'pickup',
          name: agreedOffer.lane.from.name,
          country: agreedOffer.lane.from.country,
          locality: agreedOffer.lane.from.locality,
          postalCode: '',
          lat: agreedOffer.lane.from.lat,
          lng: agreedOffer.lane.from.lng,
        },
        {
          role: 'delivery',
          name: agreedOffer.lane.to.name,
          country: agreedOffer.lane.to.country,
          locality: agreedOffer.lane.to.locality,
          postalCode: '',
          lat: agreedOffer.lane.to.lat,
          lng: agreedOffer.lane.to.lng,
        },
      ],
      notes: `From agreed offer ${agreedOffer.offerId} · ${agreedOffer.customerName}`,
      source: 'demo',
      withRoute: true,
      referenceNumber: agreedOffer.customerReference ?? undefined,
      capacity: {
        maxWeightT: 24,
        maxLdm: 13.6,
        usedWeightT: agreedOffer.lane.weightT,
        usedLdm: agreedOffer.lane.ldm ?? 8,
      },
      commercials: {
        baseRevenueEur: agreedOffer.quoteNetEur,
        baseCostEur: Math.round(agreedOffer.quoteNetEur * 0.63),
        exchangeFeePct: 0.05,
        exchangeFeeFlatEur: 15,
      },
    })
    orderId = order.id
  }

  const now = new Date().toISOString()
  const run: TransportRun = {
    id: randomUUID(),
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    sourceTransportId,
    createdAt: now,
    updatedAt: now,
    stageEnteredAt: now,
    status: 'awaiting_carrier_search',
    agreedOffer,
    orderId,
    carrierStrategy: null,
    listing: null,
    vehicleHits: [],
    carrierProposal: null,
    approvedCarrier: null,
    approvedAt: null,
    approvedBy: null,
    truck: null,
    backloadScan: emptyBackloadScan(),
    backloadProposal: null,
    acceptedBackloads: [],
    agentLog: [],
    history: [],
  }
  touch(run, 'run_started', `Agreed offer ${agreedOffer.offerId} · ${agreedOffer.customerName}`, {
    offerId: agreedOffer.offerId,
    customerName: agreedOffer.customerName,
    quoteNetEur: agreedOffer.quoteNetEur,
    currencyCode: agreedOffer.currencyCode,
    lane: `${agreedOffer.lane.from.locality} → ${agreedOffer.lane.to.locality}`,
    weightT: agreedOffer.lane.weightT,
    customerReference: agreedOffer.customerReference,
  })
  const store = getStore()
  store.items.unshift(run)
  if (store.items.length > MAX) store.items.length = MAX
  return run
}

export function searchVehiclesForRun(runId: string, locality?: string, radiusKm = 80): TransportRun {
  const run = requireRun(runId)
  assertStatus(run, ['awaiting_carrier_search', 'carrier_proposal_pending'])
  const loc =
    locality ??
    run.agreedOffer.lane.searchLocality ??
    midpointLocality(run.agreedOffer.lane.from.locality, run.agreedOffer.lane.to.locality)
  run.vehicleHits = searchFreeVehicles({ locality: loc, radiusKm })
  run.carrierStrategy = run.carrierStrategy === 'passive' ? 'both' : 'active'
  touch(run, 'active_vehicle_search', `${run.vehicleHits.length} hits near ${loc}`)
  return run
}

export function publishListingForRun(runId: string, listingCopy: { title: string; body: string }): TransportRun {
  const run = requireRun(runId)
  assertStatus(run, ['awaiting_carrier_search', 'carrier_proposal_pending'])
  const title = listingCopy.title.trim()
  const body = listingCopy.body.trim()
  if (title.length < 8 || body.length < 40) {
    throw new Error('[internal] Listing title/body too short — agent must write a real ogłoszenie')
  }
  const lane = run.agreedOffer.lane
  run.listing = publishCarrierSearch({
    from: { name: lane.from.name, lat: lane.from.lat, lng: lane.from.lng },
    to: { name: lane.to.name, lat: lane.to.lat, lng: lane.to.lng },
    weightT: lane.weightT,
    priceHint: { amount: run.agreedOffer.quoteNetEur, currency: 'EUR' },
    reference: run.agreedOffer.customerReference ?? run.agreedOffer.offerId,
    title,
    body,
  })
  run.carrierStrategy = run.carrierStrategy === 'active' ? 'both' : 'passive'
  touch(run, 'passive_listing_published', `${run.listing.id} · ${title}`, {
    listingId: run.listing.id,
    title,
    body,
    provider: run.listing.provider,
    weightT: run.listing.weightT,
    reference: run.listing.reference,
  })
  return run
}

const DEMO_CARRIER_PARTIES: CarrierParty[] = [
  {
    companyName: 'Trans-Łódź Sp. z o.o.',
    contactName: 'Marek Nowak',
    phone: '+48 42 633 12 45',
    email: 'dyspozycja@trans-lodz.pl',
    addressLine: 'ul. Brzezińska 48',
    postalCode: '92-103',
    city: 'Łódź',
    country: 'PL',
    nip: '7251892345',
  },
  {
    companyName: 'PolHaul Logistics S.A.',
    contactName: 'Anna Wiśniewska',
    phone: '+48 61 855 70 21',
    email: 'flota@polhaul.pl',
    addressLine: 'ul. Głogowska 216',
    postalCode: '60-104',
    city: 'Poznań',
    country: 'PL',
    nip: '7792468135',
  },
  {
    companyName: 'EuroTrucks Centrum Sp. z o.o.',
    contactName: 'Piotr Zieliński',
    phone: '+48 22 490 18 77',
    email: 'oferty@eurotrucks.pl',
    addressLine: 'Al. Jerozolimskie 179',
    postalCode: '02-222',
    city: 'Warszawa',
    country: 'PL',
    nip: '5213876540',
  },
]

function pickDemoCarrierParty(seed: string): CarrierParty {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return DEMO_CARRIER_PARTIES[hash % DEMO_CARRIER_PARTIES.length]!
}

/** Collapse bullet scraps / dumps into short operator-facing prose before storing HITL copy. */
function normalizeHitlProse(raw: string, maxChars = 360): string {
  let text = raw.replace(/\r\n/g, '\n').trim()
  text = text.replace(/```[\s\S]*?```/g, ' ')
  text = text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean)
    .join(' ')
  text = text.replace(/\s+/g, ' ').trim()
  if (text.length <= maxChars) return text
  const slice = text.slice(0, maxChars)
  const stop = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '))
  if (stop >= Math.floor(maxChars * 0.45)) return slice.slice(0, stop + 1).trim()
  const space = slice.lastIndexOf(' ')
  return `${(space > 40 ? slice.slice(0, space) : slice).trim()}…`
}

export function proposeCarrier(
  runId: string,
  input: {
    source: CarrierSource
    vehicleId?: string
    offerId?: string
    summary?: string
    priceEur?: number
    rationale: string
  },
): TransportRun {
  const run = requireRun(runId)
  assertStatus(run, ['awaiting_carrier_search', 'carrier_proposal_pending'])

  const rationale = normalizeHitlProse(input.rationale)
  if (rationale.length < 20) {
    throw new Error('[internal] Carrier rationale too short — agent must explain the pick')
  }

  let proposal: CarrierProposal
  const now = new Date().toISOString()

  if (input.source === 'active_vehicle_search') {
    const vehicle = run.vehicleHits.find((v) => v.id === input.vehicleId) ?? run.vehicleHits[0]
    if (!vehicle) {
      throw new Error('[internal] No free vehicle to propose — run search first')
    }
    const party = pickDemoCarrierParty(vehicle.id)
    proposal = {
      id: `cp-${randomUUID().slice(0, 8)}`,
      source: 'active_vehicle_search',
      provider: vehicle.provider,
      summary:
        input.summary ?? `${party.companyName} · ${vehicle.vehicleType} @ ${vehicle.locality} (${vehicle.capacityT}t)`,
      rationale,
      priceEur: input.priceEur ?? null,
      party,
      vehicle,
      createdAt: now,
    }
  } else if (input.source === 'exchange_offer') {
    const offers = listOpenOffers()
    const offer = offers.find((o) => o.id === input.offerId) ?? offers[0]
    if (!offer) throw new Error('[internal] No exchange offer available')
    const party = pickDemoCarrierParty(offer.id)
    proposal = {
      id: `cp-${randomUUID().slice(0, 8)}`,
      source: 'exchange_offer',
      provider: offer.provider,
      summary: input.summary ?? `${party.companyName} · ${offer.summary}`,
      rationale,
      priceEur: input.priceEur ?? offer.price.amount,
      party,
      offerId: offer.id,
      createdAt: now,
    }
  } else {
    if (!run.listing) {
      throw new Error('[internal] Publish listing first before proposing from passive path')
    }
    const party = pickDemoCarrierParty(run.listing.id)
    proposal = {
      id: `cp-${randomUUID().slice(0, 8)}`,
      source: 'passive_listing',
      provider: run.listing.provider,
      summary:
        input.summary ?? `${party.companyName} responded to listing ${run.listing.reference} · ${run.listing.weightT}t`,
      rationale,
      priceEur: input.priceEur ?? run.listing.priceHint?.amount ?? run.agreedOffer.quoteNetEur * 0.72,
      party,
      listingId: run.listing.id,
      createdAt: now,
    }
  }

  run.carrierProposal = proposal
  run.status = 'carrier_proposal_pending'
  run.stageEnteredAt = new Date().toISOString()
  touch(run, 'carrier_proposed', `${proposal.source} · ${proposal.party.companyName}`, {
    source: proposal.source,
    provider: proposal.provider,
    summary: proposal.summary,
    rationale: proposal.rationale,
    priceEur: proposal.priceEur,
    party: proposal.party,
  })
  return run
}

export function approveCarrierProposal(runId: string, approvedBy = 'human2'): TransportRun {
  const run = requireRun(runId)
  if (run.status !== 'carrier_proposal_pending' || !run.carrierProposal) {
    throw new Error('[internal] No pending carrier proposal to approve')
  }
  run.approvedCarrier = run.carrierProposal
  run.approvedAt = new Date().toISOString()
  run.approvedBy = approvedBy
  enterStage(run, 'approved')
  touch(run, 'carrier_approved', `by ${approvedBy}`)
  return run
}

export function rejectCarrierProposal(runId: string, reason?: string): TransportRun {
  const run = requireRun(runId)
  if (run.status !== 'carrier_proposal_pending') {
    throw new Error('[internal] No pending carrier proposal to reject')
  }
  run.carrierProposal = null
  enterStage(run, 'awaiting_carrier_search')
  touch(run, 'carrier_rejected', reason ?? 'human rejected')
  return run
}

/** Start driving: place truck at origin on GH route. */
export function startDelivery(runId: string): TransportRun {
  const run = requireRun(runId)
  if (run.status !== 'approved' && run.status !== 'in_transit') {
    throw new Error('[internal] Approve carrier first before starting delivery')
  }
  const order = requireOrder(run)
  const from = order.route?.from ?? {
    lat: run.agreedOffer.lane.from.lat,
    lng: run.agreedOffer.lane.from.lng,
  }
  const cap = capacitySnapshot(order, false)
  run.truck = {
    lat: from.lat,
    lng: from.lng,
    alongRouteKm: 0,
    progressPct: 0,
    updatedAt: new Date().toISOString(),
    ...cap,
  }
  run.backloadScan = emptyBackloadScan()
  enterStage(run, 'in_transit')
  touch(run, 'delivery_started', order.referenceNumber, {
    orderId: order.id,
    referenceNumber: order.referenceNumber,
    distanceKm: order.route?.distanceM ? Math.round(order.route.distanceM / 100) / 10 : null,
    demoTripSec: DEMO_TRIP_DURATION_SEC,
  })
  return run
}

/**
 * Advance truck along GraphHopper polyline (demo: ~0.83%/s → ~2 min trip).
 * Does NOT scan backloads — monitoring only. History stays quiet unless `record`.
 */
export function advanceTruck(
  runId: string,
  stepPct: number = DEMO_TRIP_STEP_PCT,
  opts?: { record?: boolean },
): {
  run: TransportRun
  position: TruckPosition
} {
  const run = requireRun(runId)
  if (run.status !== 'in_transit' && run.status !== 'backload_proposal_pending') {
    throw new Error('[internal] Delivery not in progress')
  }
  // Don't move while HITL is pending — operator is deciding
  if (run.status === 'backload_proposal_pending') {
    if (!run.truck) throw new Error('[internal] No truck position')
    return { run, position: run.truck }
  }
  const order = requireOrder(run)
  const coords = order.route?.points?.coordinates
  if (!coords?.length) throw new Error('[internal] Order has no route geometry')

  const prev = run.truck?.progressPct ?? 0
  const progressPct = Math.min(100, Math.round((prev + stepPct) * 100) / 100)
  const { lat, lng } = pointAtProgress(coords, progressPct)
  const distanceKm = order.route?.distanceM ? order.route.distanceM / 1000 : 300
  const alongRouteKm = Math.round(distanceKm * (progressPct / 100) * 10) / 10
  const cap = capacitySnapshot(order, progressPct > 0 && progressPct < 100)

  const position: TruckPosition = {
    lat,
    lng,
    alongRouteKm,
    progressPct,
    updatedAt: new Date().toISOString(),
    ...cap,
  }
  run.truck = position
  run.status = progressPct >= 100 ? 'completed' : 'in_transit'
  run.updatedAt = position.updatedAt
  if (opts?.record || progressPct >= 100) {
    touch(run, progressPct >= 100 ? 'delivery_completed' : 'truck_advanced', `${progressPct}% · ${alongRouteKm} km`, {
      progressPct,
      alongRouteKm,
      freeWeightT: position.freeWeightT,
      freeLdm: position.freeLdm,
    })
  }
  return { run, position }
}

/**
 * Full-corridor backload search once (or force retry). UI shows radius sweep separately.
 */
export function scanBackloadsAlongRun(
  runId: string,
  opts?: { force?: boolean; radiusKm?: number },
): {
  run: TransportRun
  aheadCandidates: BackloadCandidate[]
} {
  const run = requireRun(runId)
  if (run.status !== 'in_transit' && run.status !== 'backload_proposal_pending') {
    throw new Error('[internal] Delivery not in progress')
  }
  // Pending HITL — don't rescind unless force after reject
  if (run.status === 'backload_proposal_pending' && !opts?.force) {
    return { run, aheadCandidates: [] }
  }
  if (run.backloadScan.status === 'done' && !opts?.force) {
    return { run, aheadCandidates: [] }
  }

  const order = requireOrder(run)
  const coords = order.route?.points?.coordinates
  if (!coords?.length) throw new Error('[internal] Order has no route geometry')

  const radiusKm = opts?.radiusKm ?? DEMO_BACKLOAD_RADIUS_KM
  const along = run.truck?.alongRouteKm ?? 0
  const progressPct = run.truck?.progressPct ?? 0
  const center = pointAtProgress(coords, progressPct)

  run.backloadScan = {
    status: 'scanning',
    radiusKm,
    progressPct,
    center,
    candidatesCount: 0,
    lastScanAt: new Date().toISOString(),
    aheadCandidateIds: [],
  }

  const search = searchBackloadsAlongRoute({
    orderId: order.id,
    radiusKm,
    maxResults: 20,
    fromAlongKm: along,
  })
  const aheadCandidates = search.candidates.filter(
    (c) => c.kind === 'freight' && c.alongRouteKm >= along && c.economics.fitsFreeCapacity,
  )

  run.backloadScan = {
    status: 'done',
    radiusKm,
    progressPct: 100,
    center: pointAtProgress(coords, 100),
    candidatesCount: aheadCandidates.length,
    lastScanAt: new Date().toISOString(),
    aheadCandidateIds: aheadCandidates.map((c) => c.id),
  }
  // Allow a new propose after force rescan
  if (opts?.force && run.status === 'backload_proposal_pending') {
    run.backloadProposal = null
    run.status = 'in_transit'
  }
  touch(run, 'backload_scan', `${aheadCandidates.length} do przodu · r=${radiusKm} km · od ${along} km`, {
    radiusKm,
    candidatesCount: aheadCandidates.length,
    candidates: aheadCandidates.slice(0, 5).map((c) => ({
      id: c.id,
      summary: c.summary,
      alongRouteKm: c.alongRouteKm,
      netEur: c.economics.netEur,
      feeEur: c.economics.exchangeFeeEur,
      fits: c.economics.fitsFreeCapacity,
    })),
  })
  return { run, aheadCandidates }
}

/** Update scan-sweep cursor for map UI (client drives animation). */
export function updateBackloadScanProgress(runId: string, progressPct: number): TransportRun {
  const run = requireRun(runId)
  const order = requireOrder(run)
  const coords = order.route?.points?.coordinates
  if (!coords?.length) return run
  const pct = Math.min(100, Math.max(0, progressPct))
  run.backloadScan = {
    ...run.backloadScan,
    status: pct >= 100 && run.backloadScan.status === 'done' ? 'done' : 'scanning',
    progressPct: pct,
    center: pointAtProgress(coords, pct),
  }
  run.updatedAt = new Date().toISOString()
  return run
}

/**
 * @deprecated Prefer advanceTruck + scanBackloadsAlongRun.
 * Kept for older tool calls: advances then scans ahead.
 */
export function advanceTruckAndScanBackloads(
  runId: string,
  stepPct = 12,
): {
  run: TransportRun
  aheadCandidates: BackloadCandidate[]
  position: TruckPosition
} {
  const { run, position } = advanceTruck(runId, stepPct, { record: true })
  if (position.progressPct >= 100) {
    return { run, aheadCandidates: [], position }
  }
  const scanned = scanBackloadsAlongRun(runId, { force: true })
  return {
    run: scanned.run,
    aheadCandidates: scanned.aheadCandidates,
    position: scanned.run.truck!,
  }
}

export function proposeBackload(runId: string, candidateId: string, evaluation: string): TransportRun {
  const run = requireRun(runId)
  if (run.status !== 'in_transit' && run.status !== 'backload_proposal_pending') {
    throw new Error('[internal] Not in transit')
  }
  const evalText = normalizeHitlProse(evaluation)
  if (evalText.length < 30) {
    throw new Error('[internal] Backload evaluation too short — agent must justify the pick')
  }
  const order = requireOrder(run)
  const search = searchBackloadsAlongRoute({
    orderId: order.id,
    maxResults: 30,
    fromAlongKm: run.truck?.alongRouteKm ?? 0,
  })
  const candidate = search.candidates.find((c) => c.id === candidateId)
  if (!candidate) throw new Error(`[internal] Backload candidate ${candidateId} not found`)
  if (!candidate.economics.fitsFreeCapacity) {
    throw new Error('[internal] Candidate does not fit free capacity')
  }

  const along = run.truck?.alongRouteKm ?? 0
  if (candidate.alongRouteKm < along) {
    throw new Error('[internal] Kandydat jest za ciężarówką — proponuj tylko do przodu')
  }

  run.backloadProposal = {
    id: `bp-${randomUUID().slice(0, 8)}`,
    candidate,
    evaluation: evalText,
    createdAt: new Date().toISOString(),
    progressPctAtProposal: run.truck?.progressPct ?? 0,
  }
  enterStage(run, 'backload_proposal_pending')
  touch(run, 'backload_proposed', candidate.summary, {
    candidateId: candidate.id,
    summary: candidate.summary,
    evaluation: evalText,
    alongRouteKm: candidate.alongRouteKm,
    weightT: candidate.weightT,
    economics: candidate.economics,
    progressPctAtProposal: run.truck?.progressPct ?? 0,
  })
  return run
}

export function appendAgentLog(runId: string, agent: 'carrier_finder' | 'load_optimizer', text: string): TransportRun {
  const run = requireRun(runId)
  const trimmed = text.trim()
  if (!trimmed) return run
  run.agentLog.unshift({
    at: new Date().toISOString(),
    agent,
    text: trimmed.slice(0, 4000),
  })
  if (run.agentLog.length > 12) run.agentLog.length = 12
  run.updatedAt = new Date().toISOString()
  return run
}

export function approveBackloadProposal(runId: string, approvedBy = 'human2'): TransportRun {
  const run = requireRun(runId)
  if (run.status !== 'backload_proposal_pending' || !run.backloadProposal) {
    throw new Error('[internal] No pending backload proposal')
  }
  const candidate = run.backloadProposal.candidate
  run.acceptedBackloads.push(candidate)
  // Consume free capacity on the linked order
  if (run.orderId) {
    const order = getOrder(run.orderId)
    if (order) {
      order.capacity = deriveCapacity({
        ...order.capacity,
        usedWeightT: order.capacity.usedWeightT + (candidate.weightT ?? 0),
        usedLdm: order.capacity.usedLdm + Math.min(2, (candidate.weightT ?? 0) * 0.15),
      })
      order.commercials = deriveCommercials({
        ...order.commercials,
        baseRevenueEur: order.commercials.baseRevenueEur + candidate.economics.revenueEur,
        baseCostEur:
          order.commercials.baseCostEur + candidate.economics.detourCostEur + candidate.economics.exchangeFeeEur,
      })
      order.updatedAt = new Date().toISOString()
    }
  }
  run.backloadProposal = null
  enterStage(run, 'in_transit')
  if (run.truck && run.orderId) {
    const order = getOrder(run.orderId)
    if (order) {
      run.truck = {
        ...run.truck,
        ...capacitySnapshot(order, false),
        updatedAt: new Date().toISOString(),
      }
    }
  }
  touch(run, 'backload_approved', `by ${approvedBy} · +${candidate.economics.netEur} EUR net`, {
    netEur: candidate.economics.netEur,
    summary: candidate.summary,
  })
  return run
}

export function rejectBackloadProposal(runId: string, reason?: string): TransportRun {
  const run = requireRun(runId)
  if (run.status !== 'backload_proposal_pending') {
    throw new Error('[internal] No pending backload')
  }
  run.backloadProposal = null
  enterStage(run, 'in_transit')
  touch(run, 'backload_rejected', reason ?? 'human rejected')
  return run
}

/**
 * Deterministic finish for an agent-wait stage when the LLM is slow/stuck.
 * Used by escalating stage budget (~30–40s) so the demo never hangs.
 */
export function forceCompleteAgentStage(runId: string): {
  run: TransportRun
  forced: boolean
  stage: string
} {
  const run = requireRun(runId)

  if (run.status === 'awaiting_carrier_search') {
    if (!run.vehicleHits.length) searchVehiclesForRun(runId)
    if (!run.listing) {
      const lane = run.agreedOffer.lane
      publishListingForRun(runId, {
        title: `FTL ${lane.from.locality} → ${lane.to.locality} · ${lane.weightT}t`,
        body: [
          `Szukamy przewoźnika na trasę ${lane.from.locality} → ${lane.to.locality}.`,
          `Ładunek ~${lane.weightT} t / ${lane.ldm ?? 8} LDM, naczepa standard.`,
          `Ref: ${run.agreedOffer.customerReference ?? run.agreedOffer.offerId}.`,
          'Załadunek ASAP — odpowiedź przez Open Mercato.',
        ].join(' '),
      })
    }
    const still = requireRun(runId)
    if (!still.carrierProposal) {
      const vehicle = still.vehicleHits[0]
      const price = Math.round(still.agreedOffer.quoteNetEur * 0.72) || still.agreedOffer.quoteNetEur
      proposeCarrier(runId, {
        source: vehicle ? 'active_vehicle_search' : 'passive_listing',
        vehicleId: vehicle?.id,
        priceEur: price,
        rationale:
          'Najbliższy wolny zestaw na korytarzu, pasuje tonażowo i jest w budżecie podwykonania — proponuję do akceptacji.',
      })
    }
    appendAgentLog(
      runId,
      'carrier_finder',
      'Dobiłem etap wyszukiwania (limit czasu demo) — propozycja przewoźnika gotowa do decyzji.',
    )
    return {
      run: requireRun(runId),
      forced: true,
      stage: 'awaiting_carrier_search',
    }
  }

  if (run.status === 'approved') {
    startDelivery(runId)
    appendAgentLog(runId, 'carrier_finder', 'Start dostawy po limicie czasu etapu — ciężarówka na trasie GraphHopper.')
    return { run: requireRun(runId), forced: true, stage: 'approved' }
  }

  if (run.status === 'in_transit' && run.backloadScan.status === 'idle') {
    const { aheadCandidates } = scanBackloadsAlongRun(runId, { force: true })
    const best = aheadCandidates.slice().sort((a, b) => b.economics.netEur - a.economics.netEur)[0]
    if (best) {
      proposeBackload(
        runId,
        best.id,
        `Najlepszy doładunek na korytarzu: net ~${best.economics.netEur} EUR po prowizji, mieści się w wolnej pojemności.`,
      )
      appendAgentLog(
        runId,
        'load_optimizer',
        'Skan zakończony limitem czasu — wybrałem najlepszy doładunek do decyzji.',
      )
    } else {
      appendAgentLog(runId, 'load_optimizer', 'Skan korytarza zakończony — brak opłacalnego doładunku z przodu.')
    }
    return { run: requireRun(runId), forced: true, stage: 'backload_scan' }
  }

  return { run, forced: false, stage: run.status }
}

/** Escalate search stages: rising probability after RAMP, hard force at BUDGET. */
export function maybeEscalateAgentStage(
  runId: string,
  opts?: { elapsedMs?: number; force?: boolean },
): { run: TransportRun; forced: boolean; elapsedMs: number; stage: string } {
  const run = requireRun(runId)
  if (!run.stageEnteredAt) run.stageEnteredAt = run.updatedAt || run.createdAt
  const elapsedMs = opts?.elapsedMs ?? stageElapsedMs(run)
  const needsProgress =
    run.status === 'awaiting_carrier_search' ||
    run.status === 'approved' ||
    (run.status === 'in_transit' && run.backloadScan.status === 'idle')
  if (!needsProgress) {
    return { run, forced: false, elapsedMs, stage: run.status }
  }
  const force = opts?.force === true || shouldEscalateAgentStage(elapsedMs)
  if (!force) return { run, forced: false, elapsedMs, stage: run.status }
  const result = forceCompleteAgentStage(runId)
  return { ...result, elapsedMs }
}

function requireRun(id: string): TransportRun {
  const run = getTransportRun(id)
  if (!run) throw new Error(`[internal] Transport run ${id} not found`)
  return run
}

function requireOrder(run: TransportRun): LogisticsOrder {
  if (!run.orderId) throw new Error('[internal] Run has no linked logistics order')
  const order = getOrder(run.orderId)
  if (!order) throw new Error(`[internal] Order ${run.orderId} missing`)
  return order
}

export function toTransportRunView(run: TransportRun): TransportRunView {
  const order = run.orderId ? getOrder(run.orderId) : null
  return {
    ...run,
    backloadScan: run.backloadScan ?? emptyBackloadScan(),
    history: run.history ?? [],
    agentLog: run.agentLog ?? [],
    route: order?.route ?? null,
    capacity: order?.capacity ?? null,
  }
}

/** Re-plan linked orders that still have synthetic/fixture geometry once GraphHopper is up. */
export async function hydrateTransportRunRoutes(runs: TransportRun[]): Promise<void> {
  await Promise.all(
    runs.map(async (run) => {
      if (!run.orderId) return
      try {
        await upgradeOrderRouteIfNeeded(run.orderId)
      } catch {
        // Keep existing geometry if routing is still unavailable.
      }
    }),
  )
}

function assertStatus(run: TransportRun, allowed: TransportRunStatus[]) {
  if (!allowed.includes(run.status)) {
    throw new Error(`[internal] Run status is ${run.status}; expected one of ${allowed.join(', ')}`)
  }
}

function midpointLocality(a: string, b: string): string {
  const key = `${a}|${b}`
  const known: Record<string, string> = {
    'Gdańsk|Wrocław': 'Bydgoszcz',
    'Kraków|Szczecin': 'Łódź',
    'Katowice|Lublin': 'Kielce',
    'Białystok|Opole': 'Warszawa',
    'Rzeszów|Poznań': 'Łódź',
    'Toruń|Zielona Góra': 'Poznań',
    'Warszawa|Poznań': 'Łódź',
  }
  return known[key] ?? a
}

export function truckMarker(run: TransportRun): LatLng | null {
  if (!run.truck) return null
  return {
    lat: run.truck.lat,
    lng: run.truck.lng,
    name: `Truck ${run.truck.progressPct}%`,
  }
}
