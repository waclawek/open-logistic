import type { FreeSpace, TransportDetail, TransportFields, TransportOrder, TransportRow } from '../types'

/** One pill after the arrow: the client order (Order 1) or an additional load (Order 3+). */
export type LoadPill = {
  id: string
  orderNumber: string
  customerName: string
  pickupAddress: string | null
  deliveryAddress: string | null
  pallets: number | null
  kg: number | null
  price: number | null
  status: string
}

/** One board row: carrier (Order 2) on the left, client order and loads on the right. */
export type RouteBoardItem = {
  id: string
  orderNumber: string
  customerName: string
  currencyCode: string
  pickupAddress: string | null
  deliveryAddress: string | null
  pickupWindowStart: string | null
  cargoPallets: number | null
  cargoWeightKg: number | null
  clientPrice: number | null
  carrier: {
    orderId: string
    name: string
    status: 'pending_approval' | 'approved'
    cost: number | null
    vehicleType: string | null
  } | null
  loads: LoadPill[]
  /** Counts from the list read model; used while the detail is still loading. */
  loadCounts: { approved: number; pending: number }
  freeSpace: FreeSpace | null
  updatedAt: string
  /** Present only once the detail has been loaded; required for decisions. */
  transportVersion: string | null
}

export type BoardNotification = {
  id: string
  kind: 'carrier' | 'load'
  transportId: string
  transportOrderNumber: string
  transportRoute: string
  orderId: string
  actorName: string
  route: string | null
  pallets: number | null
  kg: number | null
  amount: number | null
  currencyCode: string
  /** For loads: whether the cargo fits the remaining capacity in both dimensions. */
  fits: boolean
  occurredAt: string
}

function numberField(fields: TransportFields, key: string): number | null {
  const value = fields[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringField(fields: TransportFields, key: string): string | null {
  const value = fields[key]
  return typeof value === 'string' && value.trim() ? value : null
}

export function formatRoute(pickup: string | null, delivery: string | null): string {
  return `${pickup ?? '—'} → ${delivery ?? '—'}`
}

export function toLoadPill(order: TransportOrder): LoadPill {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    pickupAddress: stringField(order.fields, 'pickup_address'),
    deliveryAddress: stringField(order.fields, 'delivery_address'),
    pallets: numberField(order.fields, 'cargo_pallets'),
    kg: numberField(order.fields, 'cargo_weight_kg'),
    price: numberField(order.fields, 'client_price'),
    status: order.status,
  }
}

/** Merges the list row with its (optional) detail into one board row. */
export function buildBoardItem(row: TransportRow, detail?: TransportDetail | null): RouteBoardItem {
  const loads = detail
    ? detail.additionalLoads
      .filter((order) => order.status !== 'rejected' && order.status !== 'cancelled')
      .map(toLoadPill)
    : []
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    customerName: row.customerName,
    currencyCode: row.currencyCode,
    pickupAddress: row.pickupAddress,
    deliveryAddress: row.deliveryAddress,
    pickupWindowStart: row.pickupWindowStart,
    cargoPallets: row.cargoPallets,
    cargoWeightKg: row.cargoWeightKg,
    clientPrice: row.clientPrice,
    carrier: row.carrier
      ? {
        orderId: row.carrier.orderId,
        name: row.carrier.name,
        status: row.carrier.status,
        cost: row.carrier.cost,
        vehicleType: row.carrier.vehicleType,
      }
      : null,
    loads,
    loadCounts: { approved: row.additionalLoads.approved, pending: row.additionalLoads.pending },
    freeSpace: detail?.freeSpace ?? row.freeSpace,
    updatedAt: detail?.updatedAt ?? row.updatedAt,
    transportVersion: detail?.transportVersion ?? null,
  }
}

function loadFits(pallets: number | null, kg: number | null, freeSpace: FreeSpace | null): boolean {
  if (!freeSpace || freeSpace.pallets == null || freeSpace.kg == null) return false
  if (pallets == null || kg == null) return false
  return pallets >= 0 && kg >= 0 && pallets <= freeSpace.pallets && kg <= freeSpace.kg
}

/**
 * Everything waiting for a dispatcher decision, newest first:
 * a carrier proposing to take the transport, or an additional load proposed for it.
 */
export function buildNotifications(details: TransportDetail[]): BoardNotification[] {
  const out: BoardNotification[] = []
  for (const detail of details) {
    const transportRoute = formatRoute(
      stringField(detail.order1.fields, 'pickup_address'),
      stringField(detail.order1.fields, 'delivery_address'),
    )
    const base = {
      transportId: detail.order1.id,
      transportOrderNumber: detail.order1.orderNumber,
      transportRoute,
      currencyCode: detail.order1.currencyCode,
    }
    if (detail.order2 && detail.order2.status === 'pending_approval') {
      const fields = detail.order2.fields
      out.push({
        ...base,
        id: `${detail.order1.id}:carrier:${detail.order2.id}`,
        kind: 'carrier',
        orderId: detail.order2.id,
        actorName: detail.order2.customerName,
        route: stringField(fields, 'vehicle_type'),
        pallets: numberField(fields, 'vehicle_capacity_pallets'),
        kg: numberField(fields, 'vehicle_capacity_kg'),
        amount: numberField(fields, 'carrier_cost'),
        fits: true,
        occurredAt: detail.order2.updatedAt,
      })
    }
    for (const order of detail.additionalLoads) {
      if (order.status !== 'pending_approval') continue
      const pill = toLoadPill(order)
      out.push({
        ...base,
        id: `${detail.order1.id}:load:${order.id}`,
        kind: 'load',
        orderId: order.id,
        actorName: order.customerName,
        route: formatRoute(pill.pickupAddress, pill.deliveryAddress),
        pallets: pill.pallets,
        kg: pill.kg,
        amount: pill.price,
        fits: loadFits(pill.pallets, pill.kg, detail.freeSpace),
        occurredAt: order.updatedAt,
      })
    }
  }
  return out.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
}
