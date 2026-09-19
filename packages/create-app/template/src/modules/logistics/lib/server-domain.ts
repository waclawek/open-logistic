import { randomUUID } from 'node:crypto'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { LogisticsOffer, LogisticsTransport } from '../data/entities'
import { cargoSchema, type TransportDecision } from '../data/validators'

export async function logisticsError(status: number, key: string): Promise<never> {
  const errorKey = `logistics.dispatcher.errors.${key}`
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(status, { error: translate(errorKey), key: errorKey })
}

export function nextVersion(current: Date): Date {
  return new Date(Math.max(Date.now(), current.getTime() + 1))
}

export async function applyTransportDecision(transport: LogisticsTransport, decision: TransportDecision, offer?: LogisticsOffer): Promise<void> {
  if (decision.action !== 'accept_load') {
    if (!transport.order2 || transport.order2.status !== 'pending') return logisticsError(409, 'carrierNotPending')
    transport.order2 = { ...transport.order2, status: decision.action === 'approve_carrier' ? 'confirmed' : 'rejected' }
  } else {
    if (!offer) return logisticsError(404, 'notFound')
    if (!cargoSchema.safeParse(offer.cargo).success) return logisticsError(400, 'invalidCargo')
    if (offer.allocatedTransportId || !['new', 'review'].includes(offer.status)) return logisticsError(409, 'offerUnavailable')
    if (transport.order1.status !== 'confirmed' || transport.order2?.status !== 'confirmed') return logisticsError(409, 'carrierNotConfirmed')
    const used = transport.additionalLoads.filter((load) => load.status === 'confirmed').reduce((total, load) => ({
      weightKg: total.weightKg + load.cargo.weightKg,
      palletSpaces: total.palletSpaces + load.cargo.palletSpaces,
    }), { ...transport.order1.cargo })
    const capacity = transport.order2.vehicle.capacity
    if (used.weightKg + offer.cargo.weightKg > capacity.weightKg || used.palletSpaces + offer.cargo.palletSpaces > capacity.palletSpaces) return logisticsError(409, 'insufficientCapacity')
    const orderNumber = Math.max(2, ...transport.additionalLoads.map((load) => load.orderNumber)) + 1
    transport.additionalLoads = [...transport.additionalLoads, { id: randomUUID(), offerId: offer.id, orderNumber, cargo: { ...offer.cargo }, status: 'confirmed' }]
    offer.status = 'accepted'
    offer.allocatedTransportId = transport.id
    offer.updatedAt = nextVersion(offer.updatedAt)
  }
  transport.updatedAt = nextVersion(transport.updatedAt)
}
