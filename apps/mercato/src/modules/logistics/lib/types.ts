export type LatLng = { lat: number; lng: number; name?: string }

export type LogisticsStop = {
  role: 'pickup' | 'delivery'
  name: string
  country: string
  locality: string
  postalCode: string
  street?: string
  number?: string
  lat: number
  lng: number
}

export type LogisticsRoute = {
  provider: 'graphhopper'
  /** live = GraphHopper API; fixture = committed WAW→POZ file; synthetic = straight-line offline fallback */
  source: 'live' | 'fixture' | 'synthetic'
  profile: string
  distanceM: number
  timeMs: number
  points: { type: 'LineString'; coordinates: [number, number][] }
  instructions: Array<{
    text: string
    distanceM: number
    timeMs: number
    sign?: number
    streetName?: string
  }>
  from: LatLng
  to: LatLng
}

export type VehicleCapacity = {
  maxWeightT: number
  maxLdm: number
  usedWeightT: number
  usedLdm: number
  /** max − used — what a backload can still take */
  freeWeightT: number
  freeLdm: number
}

export type OrderCommercials = {
  /** Revenue for the base transport job */
  baseRevenueEur: number
  /** Fully loaded operating cost for the base job (excl. exchange fees) */
  baseCostEur: number
  /** baseRevenue − baseCost */
  baseMarginEur: number
  /** Exchange commission as % of freight revenue (0.05 = 5%) */
  exchangeFeePct: number
  /** Flat fee per accepted exchange deal (EUR) */
  exchangeFeeFlatEur: number
  currency: 'EUR'
}

export type LogisticsOrder = {
  id: string
  createdAt: string
  updatedAt: string
  referenceNumber: string
  status: 'new' | 'routed' | 'imported'
  source: 'manual' | 'inbox' | 'demo'
  inboxRequestId?: string
  notes?: string
  stops: LogisticsStop[]
  route: LogisticsRoute | null
  capacity: VehicleCapacity
  commercials: OrderCommercials
  rawPayload?: unknown
}

export function deriveCapacity(partial?: Partial<VehicleCapacity>): VehicleCapacity {
  const maxWeightT = partial?.maxWeightT ?? 24
  const maxLdm = partial?.maxLdm ?? 13.6
  const usedWeightT = partial?.usedWeightT ?? 14
  const usedLdm = partial?.usedLdm ?? 8
  return {
    maxWeightT,
    maxLdm,
    usedWeightT,
    usedLdm,
    freeWeightT: Math.max(0, Math.round((maxWeightT - usedWeightT) * 10) / 10),
    freeLdm: Math.max(0, Math.round((maxLdm - usedLdm) * 10) / 10),
  }
}

export function deriveCommercials(partial?: Partial<OrderCommercials>): OrderCommercials {
  const baseRevenueEur = partial?.baseRevenueEur ?? 980
  const baseCostEur = partial?.baseCostEur ?? 620
  const exchangeFeePct = partial?.exchangeFeePct ?? 0.05
  const exchangeFeeFlatEur = partial?.exchangeFeeFlatEur ?? 15
  return {
    baseRevenueEur,
    baseCostEur,
    baseMarginEur:
      partial?.baseMarginEur ?? Math.round((baseRevenueEur - baseCostEur) * 10) / 10,
    exchangeFeePct,
    exchangeFeeFlatEur,
    currency: 'EUR',
  }
}

export const WAW_POZ = {
  pickup: {
    role: 'pickup' as const,
    name: 'Warszawa',
    country: 'PL',
    locality: 'Warszawa',
    postalCode: '00-001',
    street: 'Marszałkowska',
    number: '1',
    lat: 52.2297,
    lng: 21.0122,
  },
  delivery: {
    role: 'delivery' as const,
    name: 'Poznań',
    country: 'PL',
    locality: 'Poznań',
    postalCode: '60-001',
    street: 'Święty Marcin',
    number: '1',
    lat: 52.4064,
    lng: 16.9252,
  },
}
