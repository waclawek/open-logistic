import { randomUUID } from 'node:crypto'
import type { LogisticsOrder, LogisticsRoute, LogisticsStop, OrderCommercials, VehicleCapacity } from './types'
import { WAW_POZ, deriveCapacity, deriveCommercials } from './types'
import { planRoute } from './graphhopper'

const STORE_KEY = '__openMercatoLogisticsOrdersStore__'
const MAX = 100

type Store = { items: LogisticsOrder[] }

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

export function listOrders(limit = 50): LogisticsOrder[] {
  return getStore().items.slice(0, Math.min(Math.max(limit, 1), MAX))
}

export function getOrder(id: string): LogisticsOrder | null {
  return getStore().items.find((o) => o.id === id) ?? null
}

export function clearOrders(): number {
  const store = getStore()
  const n = store.items.length
  store.items = []
  return n
}

function nextRef(): string {
  const n = getStore().items.length + 1
  return `LOG/${new Date().getFullYear()}/${String(n).padStart(4, '0')}`
}

export async function createOrder(input: {
  stops: LogisticsStop[]
  notes?: string
  source?: LogisticsOrder['source']
  inboxRequestId?: string
  rawPayload?: unknown
  referenceNumber?: string
  withRoute?: boolean
  capacity?: Partial<VehicleCapacity>
  commercials?: Partial<OrderCommercials>
}): Promise<LogisticsOrder> {
  if (input.stops.length < 2) {
    throw new Error('[internal] Order needs at least pickup + delivery stops')
  }
  const now = new Date().toISOString()
  let route: LogisticsRoute | null = null
  let status: LogisticsOrder['status'] = 'new'

  if (input.withRoute !== false) {
    const pickup = input.stops.find((s) => s.role === 'pickup') ?? input.stops[0]
    const delivery = input.stops.find((s) => s.role === 'delivery') ?? input.stops[input.stops.length - 1]
    route = await planRoute(
      { lat: pickup.lat, lng: pickup.lng, name: pickup.name },
      { lat: delivery.lat, lng: delivery.lng, name: delivery.name },
    )
    status = 'routed'
  }

  const order: LogisticsOrder = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    referenceNumber: input.referenceNumber || nextRef(),
    status: input.source === 'inbox' && status === 'routed' ? 'imported' : status,
    source: input.source ?? 'manual',
    inboxRequestId: input.inboxRequestId,
    notes: input.notes,
    stops: input.stops,
    route,
    capacity: deriveCapacity(input.capacity),
    commercials: deriveCommercials(input.commercials),
    rawPayload: input.rawPayload,
  }

  const store = getStore()
  store.items.unshift(order)
  if (store.items.length > MAX) store.items.length = MAX
  return order
}

export async function createWawPozDemo(notes?: string): Promise<LogisticsOrder> {
  return createOrder({
    stops: [WAW_POZ.pickup, WAW_POZ.delivery],
    notes: notes ?? 'Demo zlecenie Warszawa → Poznań (GraphHopper)',
    source: 'demo',
    withRoute: true,
    capacity: {
      maxWeightT: 24,
      maxLdm: 13.6,
      usedWeightT: 14,
      usedLdm: 8,
    },
    commercials: {
      baseRevenueEur: 980,
      baseCostEur: 620,
      exchangeFeePct: 0.05,
      exchangeFeeFlatEur: 15,
    },
  })
}

export async function attachRoute(orderId: string): Promise<LogisticsOrder> {
  const order = getOrder(orderId)
  if (!order) throw new Error('[internal] Order not found')
  const pickup = order.stops.find((s) => s.role === 'pickup') ?? order.stops[0]
  const delivery =
    order.stops.find((s) => s.role === 'delivery') ?? order.stops[order.stops.length - 1]
  const route = await planRoute(
    { lat: pickup.lat, lng: pickup.lng, name: pickup.name },
    { lat: delivery.lat, lng: delivery.lng, name: delivery.name },
  )
  order.route = route
  order.status = order.source === 'inbox' ? 'imported' : 'routed'
  order.updatedAt = new Date().toISOString()
  return order
}

/**
 * Upgrade straight-line / offline fallback geometry to a live GraphHopper road path when the
 * routing service is available. No-op when the order already has `source: 'live'`.
 */
export async function upgradeOrderRouteIfNeeded(orderId: string): Promise<LogisticsOrder | null> {
  const order = getOrder(orderId)
  if (!order) return null
  if (order.route?.source === 'live') return order
  return attachRoute(orderId)
}

/** Best-effort parse of Trans inbox order / freight payload into stops. */
export function stopsFromInboxBody(body: unknown): LogisticsStop[] | null {
  if (!body || typeof body !== 'object') return null
  const root = body as Record<string, unknown>
  const payload =
    root.payload && typeof root.payload === 'object'
      ? (root.payload as Record<string, unknown>)
      : root

  if (Array.isArray(payload.stops) && payload.stops.length >= 2) {
    const stops: LogisticsStop[] = []
    for (const raw of payload.stops) {
      if (!raw || typeof raw !== 'object') continue
      const s = raw as Record<string, unknown>
      const coords = (s.coordinates || {}) as Record<string, unknown>
      const lat = Number(coords.latitude ?? s.lat)
      const lng = Number(coords.longitude ?? s.lng ?? s.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      const roleRaw = String(s.role ?? '')
      const role: LogisticsStop['role'] =
        roleRaw === 'delivery' || roleRaw === 'unloading' ? 'delivery' : 'pickup'
      stops.push({
        role,
        name: String(s.name ?? s.locality ?? 'Stop'),
        country: String(s.country ?? 'PL'),
        locality: String(s.locality ?? s.name ?? ''),
        postalCode: String(s.postal_code ?? s.postalCode ?? ''),
        street: s.street ? String(s.street) : undefined,
        number: s.number ? String(s.number) : undefined,
        lat,
        lng,
      })
    }
    if (stops.length >= 2) {
      stops[0].role = 'pickup'
      stops[stops.length - 1].role = 'delivery'
      return stops
    }
  }

  const hint = payload.route_hint as Record<string, unknown> | undefined
  if (hint?.from && hint?.to) {
    const from = hint.from as Record<string, unknown>
    const to = hint.to as Record<string, unknown>
    return [
      {
        role: 'pickup',
        name: String(from.name ?? 'Pickup'),
        country: 'PL',
        locality: String(from.name ?? ''),
        postalCode: '',
        lat: Number(from.lat),
        lng: Number(from.lng),
      },
      {
        role: 'delivery',
        name: String(to.name ?? 'Delivery'),
        country: 'PL',
        locality: String(to.name ?? ''),
        postalCode: '',
        lat: Number(to.lat),
        lng: Number(to.lng),
      },
    ]
  }

  // freight.spots shape
  if (Array.isArray(payload.spots) && payload.spots.length >= 2) {
    const stops: LogisticsStop[] = []
    for (const spot of payload.spots) {
      if (!spot || typeof spot !== 'object') continue
      const sp = spot as Record<string, unknown>
      const place = (sp.place || {}) as Record<string, unknown>
      const coords = (place.coordinates || {}) as Record<string, unknown>
      const addr = (place.address || {}) as Record<string, unknown>
      const lat = Number(coords.latitude)
      const lng = Number(coords.longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      const ops = Array.isArray(sp.operations) ? sp.operations : []
      const isUnload = ops.some(
        (o) => o && typeof o === 'object' && (o as { type?: string }).type === 'unloading',
      )
      stops.push({
        role: isUnload ? 'delivery' : 'pickup',
        name: String(sp.name ?? addr.locality ?? 'Stop'),
        country: String(addr.country ?? 'PL').toUpperCase().slice(0, 2),
        locality: String(addr.locality ?? ''),
        postalCode: String(addr.postal_code ?? ''),
        street: addr.street ? String(addr.street) : undefined,
        number: addr.number ? String(addr.number) : undefined,
        lat,
        lng,
      })
    }
    if (stops.length >= 2) {
      stops[0].role = 'pickup'
      stops[stops.length - 1].role = 'delivery'
      return stops
    }
  }

  return null
}
