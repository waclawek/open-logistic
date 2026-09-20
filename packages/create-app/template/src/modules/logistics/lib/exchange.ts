import { randomUUID } from 'node:crypto'
import type { LogisticsOrder, LogisticsRoute, OrderCommercials, VehicleCapacity } from './types'
import { deriveCapacity, deriveCommercials } from './types'
import { getOrder } from './orders-store'
import { planRoute } from './graphhopper'

export type ExchangeOffer = {
  id: string
  provider: 'trans' | 'timocom'
  kind: 'freight_offer' | 'quote'
  status: 'open' | 'accepted' | 'rejected'
  price: { amount: number; currency: string }
  from: { name: string; lat: number; lng: number }
  to: { name: string; lat: number; lng: number }
  summary: string
  createdAt: string
}

export type CarrierSearchListing = {
  id: string
  provider: 'trans' | 'timocom'
  status: 'published'
  lookingFor: 'carrier'
  from: { name: string; lat: number; lng: number }
  to: { name: string; lat: number; lng: number }
  weightT: number
  priceHint?: { amount: number; currency: string }
  reference: string
  /** Agent-authored exchange listing headline */
  title: string
  /** Agent-authored full ogłoszenie body (PL/EN) */
  body: string
  publishedAt: string
}

export type FreeVehicle = {
  id: string
  provider: 'trans' | 'timocom'
  locality: string
  country: string
  lat: number
  lng: number
  radiusKm: number
  vehicleType: string
  capacityT: number
  availableFrom: string
  remark: string
}

export type BackloadCandidate = {
  id: string
  provider: 'timocom' | 'trans'
  kind: 'freight' | 'capacity'
  score: number
  detourKmEstimate: number
  alongRouteKm: number
  from: { name: string; lat: number; lng: number }
  to: { name: string; lat: number; lng: number }
  price: { amount: number; currency: string }
  weightT: number
  summary: string
  samplePointIndex: number
  /** Economics for agent judgment — not a hard decision */
  economics: {
    revenueEur: number
    exchangeFeeEur: number
    detourCostEur: number
    /** revenue − exchangeFee − detourCost */
    netEur: number
    eurPerExtraKm: number | null
    costPerKmEur: number
    /** Candidate weight vs order.capacity.freeWeightT */
    fitsFreeCapacity: boolean
    freeWeightT: number
    freeLdm: number
    requiredWeightT: number
    /** Base job margin from order.commercials */
    baseMarginEur: number
    /** baseMargin + netEur (combined trip view) */
    combinedMarginEur: number
    worthConsideringHint: boolean
    rationale: string
  }
}

const STORE_KEY = '__openMercatoLogisticsExchangeStore__'

type ExchangeStore = {
  offers: ExchangeOffer[]
  listings: CarrierSearchListing[]
  vehicles: FreeVehicle[]
  accepts: Array<{ id: string; offerId: string; acceptedAt: string; result: unknown }>
}

function store(): ExchangeStore {
  const scope = globalThis as Record<string, unknown>
  const existing = scope[STORE_KEY] as ExchangeStore | undefined
  if (existing?.offers) return existing
  const seeded = seedExchange()
  scope[STORE_KEY] = seeded
  return seeded
}

function seedExchange(): ExchangeStore {
  const now = new Date().toISOString()
  return {
    offers: [
      {
        id: 'offer-waw-poz-1',
        provider: 'trans',
        kind: 'freight_offer',
        status: 'open',
        price: { amount: 980, currency: 'EUR' },
        from: { name: 'Warszawa', lat: 52.2297, lng: 21.0122 },
        to: { name: 'Poznań', lat: 52.4064, lng: 16.9252 },
        summary: 'Trans offer WAW→POZ curtainsider 22t',
        createdAt: now,
      },
      {
        id: 'offer-waw-krk-1',
        provider: 'timocom',
        kind: 'quote',
        status: 'open',
        price: { amount: 720, currency: 'EUR' },
        from: { name: 'Warszawa', lat: 52.2297, lng: 21.0122 },
        to: { name: 'Kraków', lat: 50.0647, lng: 19.945 },
        summary: 'TIMOCOM quote WAW→KRK',
        createdAt: now,
      },
    ],
    listings: [],
    vehicles: [
      {
        id: 'veh-lodz-1',
        provider: 'timocom',
        locality: 'Łódź',
        country: 'PL',
        lat: 51.7592,
        lng: 19.456,
        radiusKm: 80,
        vehicleType: 'SEMI_TRAILER',
        capacityT: 24,
        availableFrom: now,
        remark: 'Wolna naczepa w Łodzi — korytarz A2',
      },
      {
        id: 'veh-konin-1',
        provider: 'timocom',
        locality: 'Konin',
        country: 'PL',
        lat: 52.223,
        lng: 18.251,
        radiusKm: 60,
        vehicleType: 'CURTAIN_SIDER',
        capacityT: 22,
        availableFrom: now,
        remark: 'Wolny samochód Konin (po drodze WAW→POZ)',
      },
      {
        id: 'veh-poznan-1',
        provider: 'trans',
        locality: 'Poznań',
        country: 'PL',
        lat: 52.4064,
        lng: 16.9252,
        radiusKm: 50,
        vehicleType: 'BOX',
        capacityT: 18,
        availableFrom: now,
        remark: 'Wolne auto Poznań',
      },
      {
        id: 'veh-warszawa-1',
        provider: 'trans',
        locality: 'Warszawa',
        country: 'PL',
        lat: 52.2297,
        lng: 21.0122,
        radiusKm: 40,
        vehicleType: 'SEMI_TRAILER',
        capacityT: 24,
        availableFrom: now,
        remark: 'Wolny zestaw Warszawa',
      },
    ],
    accepts: [],
  }
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Sample GeoJSON LineString [lng,lat] every ~stepKm along cumulative distance. */
export function sampleCorridor(
  coordinates: [number, number][],
  stepKm = 50,
): Array<{ lat: number; lng: number; alongKm: number; index: number }> {
  if (coordinates.length < 2) return []
  const out: Array<{ lat: number; lng: number; alongKm: number; index: number }> = []
  let cum = 0
  let nextAt = 0
  out.push({
    lng: coordinates[0][0],
    lat: coordinates[0][1],
    alongKm: 0,
    index: 0,
  })
  for (let i = 1; i < coordinates.length; i++) {
    const prev = { lng: coordinates[i - 1][0], lat: coordinates[i - 1][1] }
    const cur = { lng: coordinates[i][0], lat: coordinates[i][1] }
    cum += haversineKm(prev, cur)
    if (cum >= nextAt + stepKm) {
      nextAt = cum
      out.push({ lat: cur.lat, lng: cur.lng, alongKm: Math.round(cum), index: out.length })
    }
  }
  const last = coordinates[coordinates.length - 1]
  const lastPt = out[out.length - 1]
  if (!lastPt || lastPt.lat !== last[1] || lastPt.lng !== last[0]) {
    out.push({ lat: last[1], lng: last[0], alongKm: Math.round(cum), index: out.length })
  }
  return out
}

export function listOpenOffers(): ExchangeOffer[] {
  return store().offers.filter((o) => o.status === 'open')
}

export function acceptOffer(offerId: string): {
  ok: true
  acceptId: string
  offer: ExchangeOffer
  providerAction: string
} {
  const s = store()
  const offer = s.offers.find((o) => o.id === offerId)
  if (!offer) throw new Error(`[internal] Unknown offer ${offerId}`)
  if (offer.status !== 'open') throw new Error(`[internal] Offer ${offerId} is ${offer.status}`)
  offer.status = 'accepted'
  const acceptId = randomUUID()
  const providerAction =
    offer.provider === 'trans'
      ? `POST /ext/freights-api/v1/freights/offers/${offerId}/accept`
      : `DELETE /freight-exchange/3/my-freight-offers/{id}?accepted_freight_quote_id=${offerId}`
  s.accepts.unshift({
    id: acceptId,
    offerId,
    acceptedAt: new Date().toISOString(),
    result: { status: 'accepted', providerAction },
  })
  return { ok: true, acceptId, offer, providerAction }
}

export function publishCarrierSearch(input: {
  from: { name: string; lat: number; lng: number }
  to: { name: string; lat: number; lng: number }
  weightT?: number
  priceHint?: { amount: number; currency: string }
  provider?: 'trans' | 'timocom'
  reference?: string
  title: string
  body: string
}): CarrierSearchListing {
  const listing: CarrierSearchListing = {
    id: randomUUID(),
    provider: input.provider ?? 'timocom',
    status: 'published',
    lookingFor: 'carrier',
    from: input.from,
    to: input.to,
    weightT: input.weightT ?? 22,
    priceHint: input.priceHint,
    reference: input.reference ?? `SEEK/${Date.now()}`,
    title: input.title.trim(),
    body: input.body.trim(),
    publishedAt: new Date().toISOString(),
  }
  store().listings.unshift(listing)
  return listing
}

export function searchFreeVehicles(input: {
  locality?: string
  lat?: number
  lng?: number
  radiusKm?: number
}): FreeVehicle[] {
  const radius = input.radiusKm ?? 80
  const q = (input.locality || '').toLowerCase()
  return store().vehicles.filter((v) => {
    if (q && !v.locality.toLowerCase().includes(q) && !v.remark.toLowerCase().includes(q)) {
      if (input.lat == null || input.lng == null) return false
    }
    if (input.lat != null && input.lng != null) {
      const d = haversineKm({ lat: input.lat, lng: input.lng }, { lat: v.lat, lng: v.lng })
      return d <= Math.max(radius, v.radiusKm)
    }
    return Boolean(q)
  })
}

/**
 * Doładunki along GraphHopper route:
 * sample corridor → freights near sample points → economics for agent judgment.
 *
 * Agent (not this function) decides if a backload is worth taking.
 */
export function searchBackloadsAlongRoute(input: {
  orderId?: string
  route?: LogisticsRoute | null
  radiusKm?: number
  maxResults?: number
  /** Only sample / return freights at or ahead of this km along the route (truck position). */
  fromAlongKm?: number
  /** Operating cost used to price detour — agent can override */
  costPerKmEur?: number
  /** Min net EUR hint threshold (default 80) */
  minNetEurHint?: number
}): {
  orderId: string | null
  routeSource: string | null
  routeDistanceKm: number | null
  samples: number
  capacity: VehicleCapacity
  commercials: OrderCommercials
  assumptions: {
    costPerKmEur: number
    minNetEurHint: number
    radiusKm: number
    exchangeFeePct: number
    exchangeFeeFlatEur: number
    fromAlongKm: number
  }
  agentHint: string
  candidates: BackloadCandidate[]
} {
  let route = input.route ?? null
  let order: LogisticsOrder | null = null
  if (input.orderId) {
    order = getOrder(input.orderId)
    route = order?.route ?? route
  }
  if (!route?.points?.coordinates?.length) {
    throw new Error(
      '[internal] No route geometry — create/import a logistics order with GraphHopper first',
    )
  }

  const radiusKm = input.radiusKm ?? 40
  const costPerKmEur = input.costPerKmEur ?? 1.15
  const minNetEurHint = input.minNetEurHint ?? 80
  const fromAlongKm = Math.max(0, input.fromAlongKm ?? 0)
  const samples = sampleCorridor(route.points.coordinates, 55).filter(
    (s) => s.alongKm >= fromAlongKm - 0.5,
  )
  const dest = {
    name: route.to.name ?? 'Destination',
    lat: route.to.lat,
    lng: route.to.lng,
  }
  const candidates: BackloadCandidate[] = []

  const capacity = deriveCapacity(order?.capacity)
  const commercials = deriveCommercials(order?.commercials)

  function economics(revenueEur: number, detourKm: number, requiredWeightT: number): BackloadCandidate['economics'] {
    // Flat fee only applies when there is priced freight revenue
    const exchangeFeeEur =
      revenueEur > 0
        ? Math.round((revenueEur * commercials.exchangeFeePct + commercials.exchangeFeeFlatEur) * 10) / 10
        : 0
    const detourCostEur = Math.round(detourKm * costPerKmEur * 10) / 10
    const netEur = Math.round((revenueEur - exchangeFeeEur - detourCostEur) * 10) / 10
    const eurPerExtraKm =
      detourKm > 0.5 && revenueEur > 0 ? Math.round((revenueEur / detourKm) * 10) / 10 : null
    const fitsFreeCapacity = requiredWeightT <= capacity.freeWeightT + 1e-6
    const combinedMarginEur = Math.round((commercials.baseMarginEur + netEur) * 10) / 10
    const worthConsideringHint =
      fitsFreeCapacity &&
      netEur >= minNetEurHint &&
      (eurPerExtraKm == null || eurPerExtraKm >= costPerKmEur * 1.5)
    let rationale: string
    if (!fitsFreeCapacity) {
      rationale = `Nie mieści się w wolnej pojemności (potrzeba ${requiredWeightT} t, wolne ${capacity.freeWeightT} t / ${capacity.freeLdm} LDM)`
    } else if (worthConsideringHint) {
      rationale = `Netto ~${netEur} EUR po prowizji i objazdzie; łączna marża ~${combinedMarginEur} EUR — sprawdź okna czasowe`
    } else {
      rationale = `Słaby wynik netto (~${netEur} EUR) lub niski €/km — raczej do pominięcia`
    }
    return {
      revenueEur,
      exchangeFeeEur,
      detourCostEur,
      netEur,
      eurPerExtraKm,
      costPerKmEur,
      fitsFreeCapacity,
      freeWeightT: capacity.freeWeightT,
      freeLdm: capacity.freeLdm,
      requiredWeightT,
      baseMarginEur: commercials.baseMarginEur,
      combinedMarginEur,
      worthConsideringHint,
      rationale,
    }
  }

  for (const sample of samples.slice(0, -1)) {
    for (let n = 0; n < 2; n++) {
      const jitterLat = sample.lat + (n === 0 ? 0.12 : -0.08)
      const jitterLng = sample.lng + (n === 0 ? 0.15 : -0.1)
      const load = {
        name: `Doładunek@${Math.round(sample.alongKm)}km`,
        lat: jitterLat,
        lng: jitterLng,
      }
      const unload =
        n === 0
          ? dest
          : {
              name: 'Węzeł korytarza',
              lat: sample.lat + (dest.lat - sample.lat) * 0.35,
              lng: sample.lng + (dest.lng - sample.lng) * 0.35,
            }
      const offRoute = haversineKm(sample, load)
      if (offRoute > radiusKm) continue
      const detour = offRoute * 2 + haversineKm(load, unload) * 0.05
      const price = Math.round(350 + sample.alongKm * 0.4 + n * 80)
      const weightT = 8 + n * 4
      const eco = economics(price, detour, weightT)
      const score = Math.max(0, 50 + eco.netEur / 10 - detour - (eco.fitsFreeCapacity ? 0 : 40))
      candidates.push({
        id: `bl-${sample.index}-${n}-${Math.round(sample.alongKm)}`,
        provider: n === 0 ? 'timocom' : 'trans',
        kind: 'freight',
        score: Math.round(score * 10) / 10,
        detourKmEstimate: Math.round(detour * 10) / 10,
        alongRouteKm: sample.alongKm,
        from: load,
        to: unload,
        price: { amount: price, currency: 'EUR' },
        weightT,
        summary: `${load.name} → ${unload.name} · net ~${eco.netEur} EUR · free ${capacity.freeWeightT}t`,
        samplePointIndex: sample.index,
        economics: eco,
      })
    }
  }

  // One overweight candidate so agent sees capacity reject case
  if (samples.length > 2) {
    const sample = samples[Math.floor(samples.length / 2)]
    const weightT = Math.round((capacity.freeWeightT + 6) * 10) / 10
    const load = { name: `Ciężki@${sample.alongKm}km`, lat: sample.lat + 0.05, lng: sample.lng + 0.05 }
    const detour = 18
    const price = 700
    const eco = economics(price, detour, weightT)
    candidates.push({
      id: `bl-overweight-${sample.index}`,
      provider: 'timocom',
      kind: 'freight',
      score: 5,
      detourKmEstimate: detour,
      alongRouteKm: sample.alongKm,
      from: load,
      to: dest,
      price: { amount: price, currency: 'EUR' },
      weightT,
      summary: `${load.name} → ${dest.name} · OVERWEIGHT vs free ${capacity.freeWeightT}t`,
      samplePointIndex: sample.index,
      economics: eco,
    })
  }

  for (const v of store().vehicles) {
    const nearest = samples.reduce(
      (best, s) => {
        const d = haversineKm(s, { lat: v.lat, lng: v.lng })
        return d < best.d ? { d, s } : best
      },
      { d: Infinity, s: samples[0] },
    )
    if (nearest.d <= radiusKm) {
      const eco = economics(0, nearest.d, 0)
      candidates.push({
        id: `bl-veh-${v.id}`,
        provider: v.provider,
        kind: 'capacity',
        score: Math.round((40 - nearest.d) * 10) / 10,
        detourKmEstimate: Math.round(nearest.d * 10) / 10,
        alongRouteKm: nearest.s.alongKm,
        from: { name: v.locality, lat: v.lat, lng: v.lng },
        to: dest,
        price: { amount: 0, currency: 'EUR' },
        weightT: v.capacityT,
        summary: `Wolny pojazd ${v.locality} (${v.vehicleType}) — capacity signal only`,
        samplePointIndex: nearest.s.index,
        economics: {
          ...eco,
          fitsFreeCapacity: true,
          worthConsideringHint: false,
          rationale:
            'Sygnał wolnego pojazdu z giełdy — bez ceny frachtu; ignoruj netEur',
        },
      })
    }
  }

  candidates.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'freight' ? -1 : 1
    if (a.economics.fitsFreeCapacity !== b.economics.fitsFreeCapacity) {
      return a.economics.fitsFreeCapacity ? -1 : 1
    }
    return b.economics.netEur - a.economics.netEur || b.score - a.score
  })

  // Strictly ahead of / at the truck — never behind.
  const aheadOnly = candidates.filter((c) => c.alongRouteKm >= fromAlongKm - 0.5)

  const routeDistanceKm = route.distanceM
    ? Math.round((route.distanceM / 1000) * 10) / 10
    : null

  return {
    orderId: order?.id ?? input.orderId ?? null,
    routeSource: route.source,
    routeDistanceKm,
    samples: samples.length,
    capacity,
    commercials,
    assumptions: {
      costPerKmEur,
      minNetEurHint,
      radiusKm,
      exchangeFeePct: commercials.exchangeFeePct,
      exchangeFeeFlatEur: commercials.exchangeFeeFlatEur,
      fromAlongKm,
    },
    agentHint:
      'Szukaj tylko od pozycji ciężarówki do przodu. Używaj economics.netEur (po prowizji i objazdzie), fitsFreeCapacity oraz combinedMarginEur. worthConsideringHint jest tylko podpowiedzią.',
    candidates: aheadOnly.slice(0, input.maxResults ?? 15),
  }
}


export async function ensureOrderRoute(orderId: string): Promise<LogisticsOrder> {
  const order = getOrder(orderId)
  if (!order) throw new Error(`[internal] Order ${orderId} not found`)
  if (order.route) return order
  const pickup = order.stops.find((s) => s.role === 'pickup') ?? order.stops[0]
  const delivery =
    order.stops.find((s) => s.role === 'delivery') ?? order.stops[order.stops.length - 1]
  order.route = await planRoute(
    { lat: pickup.lat, lng: pickup.lng, name: pickup.name },
    { lat: delivery.lat, lng: delivery.lng, name: delivery.name },
  )
  order.status = 'routed'
  order.updatedAt = new Date().toISOString()
  return order
}

/** Machine-readable tool catalog for OM agents / OpenCode. */
export function agentToolCatalog() {
  return {
    version: 1,
    module: 'logistics',
    basePath: '/api/logistics',
    tools: [
      {
        id: 'logistics.orders.list',
        method: 'GET',
        path: '/api/logistics/orders',
        description: 'List transport jobs (with GraphHopper route when present)',
      },
      {
        id: 'logistics.orders.create_waw_poz',
        method: 'POST',
        path: '/api/logistics/orders',
        body: { action: 'demo-waw-poz' },
        description: 'Create Warszawa→Poznań job + route; mirrors to Trans inbox',
      },
      {
        id: 'logistics.orders.import_inbox',
        method: 'POST',
        path: '/api/logistics/orders',
        body: { action: 'from-inbox' },
        description: 'Import latest exchange order/freight from trans_inbox + route',
      },
      {
        id: 'exchange.offers.list',
        method: 'GET',
        path: '/api/logistics/exchange/offers',
        description: 'List open exchange offers/quotes ready to accept',
      },
      {
        id: 'exchange.offer.accept',
        method: 'POST',
        path: '/api/logistics/exchange/accept',
        body: { offerId: 'offer-waw-poz-1' },
        description: 'Accept offer from Trans/TIMOCOM (mock provider action recorded)',
        mutation: true,
      },
      {
        id: 'exchange.publish_carrier_search',
        method: 'POST',
        path: '/api/logistics/exchange/publish-carrier-search',
        body: {
          from: { name: 'Warszawa', lat: 52.2297, lng: 21.0122 },
          to: { name: 'Poznań', lat: 52.4064, lng: 16.9252 },
          weightT: 22,
        },
        description: 'Publish “poszukiwanie przewoźnika” (shipper demand) on exchange',
        mutation: true,
      },
      {
        id: 'exchange.search_free_vehicles',
        method: 'POST',
        path: '/api/logistics/exchange/search-vehicles',
        body: { locality: 'Łódź', radiusKm: 80 },
        description: 'List free vehicles / vehicle spaces near a locality',
      },
      {
        id: 'exchange.search_backloads',
        method: 'POST',
        path: '/api/logistics/exchange/search-backloads',
        body: { orderId: '<uuid>', radiusKm: 40, maxResults: 15, costPerKmEur: 1.15 },
        description:
          'Search doładunki along GH route; economics = net after exchange fee+detour, free capacity, base/combined margin — agent decides',
      },
      {
        id: 'exchange.catalog',
        method: 'GET',
        path: '/api/logistics/exchange/catalog',
        description: 'This tool catalog (for agent bootstrapping)',
      },
    ],
    backloadStrategy: {
      why:
        'Giełdy (TIMOCOM/Trans) nie przyjmują polyline — tylko okręgi/obszary A→B. Dlatego najpierw GraphHopper daje geometrię zlecenia, potem search wzdłuż korytarza.',
      steps: [
        '1. Złóż zlecenie (inbox/demo) → logistics order',
        '2. Policz trasę GraphHopper (fixture lub :8989)',
        '3. sampleCorridor co ~50–60 km',
        '4. Dla każdego punktu: freighty w radiusKm (+ capacity signals)',
        '5. Zwróć economics.* (net po prowizji, fitsFreeCapacity, base/combined margin) — agent decyduje',
      ],
      evaluationInputsDoc: '.ai/docs/logistics-agent-evaluation-inputs.md',
      productionMapping: {
        timocom: 'POST /freight-exchange/3/freight-offers/search + /vehicle-space-offers/search',
        trans: 'GET/filter freights + vehicles-api places.range',
        simTemplates: [
          'timocom: freight.offer.search, vehicle.space.search',
          'trans: freight.offer.accept, freight.create.public, vehicle.create',
        ],
      },
    },
    evaluationInputs: {
      doc: '.ai/docs/logistics-agent-evaluation-inputs.md',
      backloadRequiredFields: [
        'order.route.distanceM',
        'order.route.timeMs',
        'order.capacity.freeWeightT',
        'order.capacity.freeLdm',
        'order.commercials.baseMarginEur',
        'order.commercials.exchangeFeePct',
        'order.commercials.exchangeFeeFlatEur',
        'capacity',
        'commercials',
        'candidate.kind',
        'candidate.detourKmEstimate',
        'candidate.weightT',
        'candidate.price',
        'candidate.economics.revenueEur',
        'candidate.economics.exchangeFeeEur',
        'candidate.economics.detourCostEur',
        'candidate.economics.netEur',
        'candidate.economics.fitsFreeCapacity',
        'candidate.economics.baseMarginEur',
        'candidate.economics.combinedMarginEur',
        'candidate.economics.eurPerExtraKm',
        'candidate.economics.costPerKmEur',
        'assumptions.costPerKmEur',
        'assumptions.exchangeFeePct',
      ],
      backloadMissingForProduction: [
        'loading/unloading time windows',
        'segment-level capacity (vs trip-level freeWeightT)',
        'detention / late-penalty cost',
        'counterparty risk (Eurodebt)',
      ],
    },
  }
}
