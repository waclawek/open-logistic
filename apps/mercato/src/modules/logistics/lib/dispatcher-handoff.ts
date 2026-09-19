import { randomUUID } from 'node:crypto'
import type { LogisticsTransport } from '../data/entities'
import type { Transport } from './dispatcher-data'
import { agreedClientOfferSchema, type AgreedClientOffer } from './agreed-offer'
import { resolvePlace } from './place-coords'
import type { CarrierParty, CarrierProposal } from './transport-run-model'
import { deriveCapacity } from './types'
import { getOrder } from './orders-store'
import {
  getTransportRun,
  listTransportRuns,
  startDelivery,
  startTransportRunFromAgreedOffer,
  type TransportRun,
} from './transport-run'

export type DispatcherTransportLike = Pick<
  Transport,
  | 'id'
  | 'reference'
  | 'customer'
  | 'origin'
  | 'destination'
  | 'pickupDate'
  | 'deliveryDate'
  | 'order1'
  | 'order2'
  | 'additionalLoads'
>

export function isTransportReadyForDeliveryMonitoring(transport: DispatcherTransportLike): boolean {
  return transport.order1.status === 'confirmed' && transport.order2?.status === 'confirmed'
}

export function findRunForDispatcherTransport(transportId: string): TransportRun | null {
  return listTransportRuns(MAX_LOOKUP).find((run) => run.sourceTransportId === transportId) ?? null
}

const MAX_LOOKUP = 50

/** Map persisted dispatcher transport (Order 1 + confirmed Order 2) → agreed offer for the monitoring agents. */
export function agreedOfferFromDispatcherTransport(transport: DispatcherTransportLike): AgreedClientOffer {
  const from = resolvePlace(transport.origin)
  const to = resolvePlace(transport.destination)
  const weightT = Math.max(0.1, Math.round((transport.order1.cargo.weightKg / 1000) * 100) / 100)
  const pallets = Math.max(1, Math.round(transport.order1.cargo.palletSpaces) || 1)
  const ldm = Math.max(1, Math.round((pallets / 2) * 10) / 10)
  const quoteNetEur = 900
  const now = new Date().toISOString()
  const carrier = transport.order2?.carrier ?? 'Carrier'
  return agreedClientOfferSchema.parse({
    offerId: `dispatcher-${transport.id}`,
    status: 'agreed',
    agreedAt: now,
    quoteNetEur,
    customerName: transport.customer,
    customerEmail: `dispatch+${transport.reference.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@example.com`,
    currencyCode: 'EUR',
    customerReference: transport.reference,
    notes: `AI Przewozy ${transport.reference}: ${from.locality} → ${to.locality}. Przewoźnik ${carrier} zatwierdzony (Order 2).`,
    lineItems: [
      {
        productName: 'FTL road freight, per shipment',
        sku: 'FTL-SHIPMENT',
        quantity: '1',
        unitPrice: String(quoteNetEur),
        kind: 'service',
        description: `${from.locality} → ${to.locality}, ~${weightT} t / ${pallets} pal`,
      },
    ],
    shippingAddress: {
      company: transport.customer,
      contactName: 'Dispatch desk',
      city: from.locality,
      country: from.country,
    },
    billingAddress: {
      company: transport.customer,
      city: from.locality,
      country: from.country,
    },
    lane: {
      from,
      to,
      weightT,
      ldm,
      pallets,
      searchLocality: from.locality,
    },
  })
}

function carrierProposalFromTransport(transport: DispatcherTransportLike): CarrierProposal {
  const order2 = transport.order2!
  const from = resolvePlace(transport.origin)
  const now = new Date().toISOString()
  const party: CarrierParty = {
    companyName: order2.carrier,
    contactName: 'Dyspozycja',
    phone: '+48 22 000 00 00',
    email: `ops@${order2.carrier.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.example`,
    addressLine: '—',
    postalCode: '00-000',
    city: from.locality,
    country: from.country,
    nip: '0000000000',
  }
  const capacityT = Math.round((order2.vehicle.capacity.weightKg / 1000) * 10) / 10
  return {
    id: randomUUID(),
    source: 'exchange_offer',
    provider: 'trans',
    summary: `${order2.carrier} · ${order2.vehicle.registration} · ${capacityT} t`,
    rationale: `Przewoźnik zatwierdzony w AI Przewozach dla ${transport.reference} (Order 2). Przekazano do monitoringu dostawy.`,
    priceEur: null,
    party,
    vehicle: {
      id: `veh-${order2.vehicle.registration}`,
      provider: 'trans',
      locality: from.locality,
      country: from.country,
      lat: from.lat,
      lng: from.lng,
      radiusKm: 40,
      vehicleType: order2.vehicle.typeKey,
      capacityT,
      availableFrom: transport.pickupDate,
      remark: order2.vehicle.registration,
    },
    createdAt: now,
  }
}

/**
 * Start (or reuse) a monitoring transport-run from a fully accepted dispatcher transport.
 * Skips carrier search HITL — Order 2 is already confirmed — and starts delivery immediately.
 */
export async function startTransportRunFromDispatcherTransport(
  transport: DispatcherTransportLike,
  opts?: { startDelivery?: boolean },
): Promise<{ run: TransportRun; created: boolean }> {
  if (!isTransportReadyForDeliveryMonitoring(transport)) {
    throw new Error('[internal] Transport is not fully accepted (need Order 1 + Order 2 confirmed)')
  }
  const existing = findRunForDispatcherTransport(transport.id)
  if (existing) {
    if (opts?.startDelivery !== false && (existing.status === 'approved' || existing.status === 'in_transit')) {
      if (existing.status === 'approved') startDelivery(existing.id)
    }
    return { run: getTransportRun(existing.id) ?? existing, created: false }
  }

  const offer = agreedOfferFromDispatcherTransport(transport)
  const maxWeightT = Math.max(
    24,
    Math.round(((transport.order2?.vehicle.capacity.weightKg ?? 24000) / 1000) * 10) / 10,
  )
  const usedWeightT = Math.round((transport.order1.cargo.weightKg / 1000) * 100) / 100
  const usedPallets = transport.order1.cargo.palletSpaces
  const maxLdm = Math.max(13.6, Math.round((transport.order2?.vehicle.capacity.palletSpaces ?? 33) / 2 * 10) / 10)
  const usedLdm = Math.max(1, Math.round((usedPallets / 2) * 10) / 10)

  const run = await startTransportRunFromAgreedOffer({
    offer,
    withOrder: true,
    sourceTransportId: transport.id,
    capacity: {
      maxWeightT,
      maxLdm,
      usedWeightT,
      usedLdm,
    },
  })

  const proposal = carrierProposalFromTransport(transport)
  run.carrierProposal = proposal
  run.approvedCarrier = proposal
  run.approvedAt = new Date().toISOString()
  run.approvedBy = 'dispatcher'
  run.status = 'approved'
  run.stageEnteredAt = new Date().toISOString()
  run.history.unshift({
    at: run.updatedAt,
    event: 'carrier_approved',
    detail: `from dispatcher ${transport.reference}`,
    payload: {
      sourceTransportId: transport.id,
      reference: transport.reference,
      carrier: transport.order2?.carrier,
      registration: transport.order2?.vehicle.registration,
    },
  })

  // Apply already-confirmed additional loads (Order 3+) into acceptedBackloads + order capacity.
  let extraWeightT = 0
  let extraLdm = 0
  for (const load of transport.additionalLoads.filter((entry) => entry.status === 'confirmed')) {
    const weightT = Math.round((load.cargo.weightKg / 1000) * 100) / 100
    const ldm = Math.max(0.5, Math.round((load.cargo.palletSpaces / 2) * 10) / 10)
    extraWeightT += weightT
    extraLdm += ldm
    const freeWeightT = Math.max(0, maxWeightT - usedWeightT - extraWeightT)
    const freeLdm = Math.max(0, maxLdm - usedLdm - extraLdm)
    run.acceptedBackloads.push({
      id: load.id,
      provider: 'trans',
      kind: 'freight',
      score: 1,
      detourKmEstimate: 0,
      alongRouteKm: 0,
      from: resolvePlace(transport.origin),
      to: resolvePlace(transport.destination),
      price: { amount: 0, currency: 'EUR' },
      weightT,
      summary: `Order ${load.orderNumber} · ${weightT} t / ${load.cargo.palletSpaces} pal (z AI Przewozów)`,
      samplePointIndex: 0,
      economics: {
        revenueEur: 0,
        exchangeFeeEur: 0,
        detourCostEur: 0,
        netEur: 0,
        eurPerExtraKm: null,
        costPerKmEur: 1.1,
        fitsFreeCapacity: true,
        freeWeightT,
        freeLdm,
        requiredWeightT: weightT,
        baseMarginEur: 0,
        combinedMarginEur: 0,
        worthConsideringHint: true,
        rationale: `Doładunek Order ${load.orderNumber} już zaakceptowany w AI Przewozach.`,
      },
    })
  }
  if (run.orderId && (extraWeightT > 0 || extraLdm > 0)) {
    const order = getOrder(run.orderId)
    if (order) {
      order.capacity = deriveCapacity({
        ...order.capacity,
        usedWeightT: order.capacity.usedWeightT + extraWeightT,
        usedLdm: order.capacity.usedLdm + extraLdm,
      })
      order.updatedAt = new Date().toISOString()
    }
  }

  if (opts?.startDelivery !== false) {
    startDelivery(run.id)
  }

  return { run: getTransportRun(run.id) ?? run, created: true }
}

export function toDispatcherTransportLike(record: LogisticsTransport): DispatcherTransportLike {
  return {
    id: record.id,
    reference: record.reference,
    customer: record.customer,
    origin: record.origin,
    destination: record.destination,
    pickupDate: record.pickupDate,
    deliveryDate: record.deliveryDate,
    order1: record.order1,
    order2: record.order2,
    additionalLoads: record.additionalLoads ?? [],
  }
}
