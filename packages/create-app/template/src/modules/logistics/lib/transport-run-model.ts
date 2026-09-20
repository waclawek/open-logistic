/**
 * Client-safe transport-run model (types + demo constants).
 * Keep Node-only store/logic in `transport-run.ts` — never import that from `'use client'`.
 */
import type { AgreedClientOffer } from './agreed-offer'
import type { BackloadCandidate, FreeVehicle, CarrierSearchListing } from './exchange'
import type { LogisticsRoute, VehicleCapacity } from './types'

export type TransportRunStatus =
  | 'awaiting_carrier_search'
  | 'carrier_proposal_pending'
  | 'approved'
  | 'in_transit'
  | 'backload_proposal_pending'
  | 'completed'
  | 'cancelled'

export type CarrierSource = 'active_vehicle_search' | 'passive_listing' | 'exchange_offer'

/** Carrier company card shown on HITL approve — demo exchange payload. */
export type CarrierParty = {
  companyName: string
  contactName: string
  phone: string
  email: string
  addressLine: string
  postalCode: string
  city: string
  country: string
  nip: string
}

export type CarrierProposal = {
  id: string
  source: CarrierSource
  provider: 'trans' | 'timocom'
  summary: string
  /** Why the carrier-finder agent picked this carrier */
  rationale: string
  priceEur: number | null
  party: CarrierParty
  vehicle?: FreeVehicle
  listingId?: string
  offerId?: string
  createdAt: string
}

export type BackloadProposal = {
  id: string
  candidate: BackloadCandidate
  /** Why the load-optimizer agent proposes this doładunek */
  evaluation: string
  createdAt: string
  progressPctAtProposal: number
}

export type AgentLogEntry = {
  at: string
  agent: 'carrier_finder' | 'load_optimizer'
  text: string
}

export type HistoryPayload = Record<string, unknown>

export type HistoryEntry = {
  at: string
  event: string
  detail?: string
  /** Expandable context for inbox history (listing, rationale, economics, …) */
  payload?: HistoryPayload
}

export type TruckPosition = {
  lat: number
  lng: number
  alongRouteKm: number
  progressPct: number
  updatedAt: string
  /** Live capacity snapshot — drifts slightly while monitoring the road */
  usedWeightT: number
  freeWeightT: number
  usedLdm: number
  freeLdm: number
  maxWeightT: number
  maxLdm: number
}

/** One corridor sweep for doładunki (agent searches once; UI can retry). */
export type BackloadScanState = {
  status: 'idle' | 'scanning' | 'done'
  radiusKm: number
  /** Sweep progress 0–100 along the GH polyline */
  progressPct: number
  center: { lat: number; lng: number } | null
  candidatesCount: number
  lastScanAt: string | null
  aheadCandidateIds: string[]
}

/** Demo trip length: ~5 min at 1 Hz ticks. */
export const DEMO_TRIP_DURATION_SEC = 300
export const DEMO_TRIP_TICK_MS = 1_000
export const DEMO_TRIP_STEP_PCT = 100 / DEMO_TRIP_DURATION_SEC
export const DEMO_BACKLOAD_RADIUS_KM = 45

/**
 * Agent search stages (carrier find / start delivery / backload scan) escalate over time so the
 * demo never stalls: soft ramp from RAMP_MS, hard force at BUDGET_MS (~30–40s).
 */
export const DEMO_STAGE_RAMP_MS = 8_000
export const DEMO_STAGE_BUDGET_MS = 35_000

export type TransportRun = {
  id: string
  tenantId: string
  organizationId: string
  sourceTransportId: string | null
  createdAt: string
  updatedAt: string
  /** When the current agent-wait status (or idle backload scan) began — drives stage escalation. */
  stageEnteredAt: string
  status: TransportRunStatus
  agreedOffer: AgreedClientOffer
  orderId: string | null
  carrierStrategy: 'active' | 'passive' | 'both' | null
  listing: CarrierSearchListing | null
  vehicleHits: FreeVehicle[]
  carrierProposal: CarrierProposal | null
  approvedCarrier: CarrierProposal | null
  approvedAt: string | null
  approvedBy: string | null
  /** Set once Order 2 is stored as approved in Sales. Gates the truck for transport-backed runs. */
  carrierOrderApprovedAt: string | null
  truck: TruckPosition | null
  backloadScan: BackloadScanState
  backloadProposal: BackloadProposal | null
  acceptedBackloads: BackloadCandidate[]
  /** Last few agent narrations from LLM turns */
  agentLog: AgentLogEntry[]
  history: HistoryEntry[]
}

export type TransportRunView = TransportRun & {
  route: LogisticsRoute | null
  capacity: VehicleCapacity | null
}
