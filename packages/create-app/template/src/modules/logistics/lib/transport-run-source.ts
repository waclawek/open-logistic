import { DEMO_LANE_SEEDS, seedAgreedOffer, type AgreedClientOffer, type FreightLane } from './agreed-offer'
import { findTransportRunForSource, startTransportRunFromAgreedOffer, type TransportRunScope } from './transport-run'
import type { TransportDetail, TransportFields } from '../types'
import { WAW_POZ } from './types'

const IN_FLIGHT_KEY = '__openMercatoLogisticsTransportRunStarts__'

function inFlightStarts(): Map<string, Promise<Awaited<ReturnType<typeof startTransportRunFromAgreedOffer>>>> {
  const globalScope = globalThis as Record<string, unknown>
  const existing = globalScope[IN_FLIGHT_KEY]
  if (existing instanceof Map) {
    return existing as Map<string, Promise<Awaited<ReturnType<typeof startTransportRunFromAgreedOffer>>>>
  }
  const created = new Map<string, Promise<Awaited<ReturnType<typeof startTransportRunFromAgreedOffer>>>>()
  globalScope[IN_FLIGHT_KEY] = created
  return created
}

function text(fields: TransportFields, key: string): string | null {
  const value = fields[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function number(fields: TransportFields, key: string): number | null {
  const value = fields[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalized(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
}

function knownLocation(address: string): FreightLane['from'] | null {
  const value = normalized(address)
  const locations = [WAW_POZ.pickup, WAW_POZ.delivery, ...DEMO_LANE_SEEDS.flatMap((seed) => [seed.from, seed.to])]
  for (const location of locations) {
    if (value.includes(normalized(location.locality))) {
      return {
        name: address,
        locality: location.locality,
        country: location.country,
        lat: location.lat,
        lng: location.lng,
      }
    }
  }
  return null
}

function transportLane(
  detail: TransportDetail,
  fallback: FreightLane,
): {
  lane: FreightLane
  usedFallback: boolean
} {
  const fields = detail.order1.fields
  const pickupAddress = text(fields, 'pickup_address')
  const deliveryAddress = text(fields, 'delivery_address')
  const from = pickupAddress ? knownLocation(pickupAddress) : null
  const to = deliveryAddress ? knownLocation(deliveryAddress) : null
  const cargoWeightKg = number(fields, 'cargo_weight_kg')
  const cargoPallets = number(fields, 'cargo_pallets')
  const laneValues = {
    weightT: cargoWeightKg && cargoWeightKg > 0 ? cargoWeightKg / 1000 : fallback.weightT,
    ...(cargoPallets && cargoPallets > 0 ? { pallets: Math.round(cargoPallets) } : {}),
    ...(cargoPallets && cargoPallets > 0 ? { ldm: Math.min(13.6, Math.max(0.4, cargoPallets * 0.4)) } : {}),
  }
  if (!from || !to) {
    return { lane: { ...fallback, ...laneValues }, usedFallback: true }
  }
  return {
    lane: {
      ...fallback,
      ...laneValues,
      from,
      to,
      searchLocality: fallback.searchLocality,
    },
    usedFallback: false,
  }
}

export function agreedOfferFromTransport(detail: TransportDetail): AgreedClientOffer {
  const seed = seedAgreedOffer()
  const fields = detail.order1.fields
  const clientPrice = number(fields, 'client_price')
  const pickupAddress = text(fields, 'pickup_address')
  const deliveryAddress = text(fields, 'delivery_address')
  const pickupWindow = text(fields, 'pickup_window_start')
  const deliveryWindow = text(fields, 'delivery_window_start')
  const { lane, usedFallback } = transportLane(detail, seed.lane)
  const routeNote =
    pickupAddress && deliveryAddress
      ? `Transport ${pickupAddress} → ${deliveryAddress}.`
      : `Transport ${detail.order1.orderNumber}.`
  const fallbackNote = usedFallback
    ? ` Demo map uses ${seed.lane.from.locality} → ${seed.lane.to.locality} because the saved addresses are not in the demo geocoder.`
    : ''
  const windowNote = [
    pickupWindow ? `Pickup ${pickupWindow}.` : '',
    deliveryWindow ? `Delivery ${deliveryWindow}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
  const quoteNetEur = clientPrice ?? seed.quoteNetEur

  return {
    ...seed,
    offerId: `transport-${detail.order1.id}`,
    agreedAt: detail.order1.updatedAt,
    quoteNetEur,
    customerName: detail.order1.customerName || seed.customerName,
    currencyCode: detail.order1.currencyCode || seed.currencyCode,
    customerReference: detail.order1.orderNumber,
    notes: `${routeNote}${fallbackNote}${windowNote ? ` ${windowNote}` : ''}`,
    lineItems: [
      {
        ...seed.lineItems[0]!,
        unitPrice: String(quoteNetEur),
        description: `${lane.from.name} to ${lane.to.name}, ~${lane.weightT} t${lane.pallets ? ` / ${lane.pallets} pallets` : ''}`,
      },
    ],
    shippingAddress: {
      ...seed.shippingAddress,
      company: detail.order1.customerName || seed.customerName,
      line1: pickupAddress ?? seed.shippingAddress?.line1,
      city: lane.from.locality,
      country: lane.from.country,
    },
    billingAddress: {
      ...seed.billingAddress,
      company: detail.order1.customerName || seed.customerName,
    },
    lane,
  }
}

export async function startTransportRunForTransport(detail: TransportDetail, scope: TransportRunScope) {
  const existing = findTransportRunForSource(detail.order1.id, scope)
  if (existing) return existing
  const key = `${scope.tenantId}:${scope.organizationId}:${detail.order1.id}`
  const inFlight = inFlightStarts()
  const pending = inFlight.get(key)
  if (pending) return pending
  const start = startTransportRunFromAgreedOffer({
    offer: agreedOfferFromTransport(detail),
    withOrder: true,
    scope,
    sourceTransportId: detail.order1.id,
  })
  inFlight.set(key, start)
  try {
    return await start
  } finally {
    if (inFlight.get(key) === start) inFlight.delete(key)
  }
}
