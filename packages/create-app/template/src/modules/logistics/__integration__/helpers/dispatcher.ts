import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import type { Offer } from '../../lib/dispatcher-data'
import type { TransportDetail } from '../../types'

export type FixtureTransport = TransportDetail & { id: string; reference: string; updatedAt: string }

function withAliases(detail: TransportDetail): FixtureTransport {
  return { ...detail, id: detail.order1.id, reference: detail.order1.orderNumber, updatedAt: detail.updatedAt }
}

export function versionHeaders(record: { updatedAt: string }) {
  return { [OPTIMISTIC_LOCK_HEADER_NAME]: record.updatedAt }
}

export async function createDispatcherFixtures(request: APIRequestContext) {
  const stamp = randomUUID()
  const offerIds: string[] = []
  const transportIds: string[] = []
  const cleanup = async () => {
    for (const [resource, ids] of [['transports', transportIds], ['offers', offerIds]] as const) {
      for (const id of ids) {
        const response = await request.get(`/api/logistics/${resource}?id=${id}`)
        const result = await readJsonSafe<{ items: Array<{ updatedAt: string }> }>(response)
        if (result?.items[0]) {
          const deleted = await request.delete(`/api/logistics/${resource}?id=${id}`, { headers: versionHeaders(result.items[0]) })
          expect(deleted.ok(), `Cleanup ${resource} ${id}`).toBe(true)
        }
      }
    }
  }
  const createOffer = async (weightKg = 2000, palletSpaces = 4) => {
    const response = await request.post('/api/logistics/offers', { data: {
      reference: `QA-OF-${stamp}-${offerIds.length}`, customer: `QA Customer ${stamp}`,
      origin: 'Warszawa', destination: 'Berlin', pickupDate: '2026-09-21', deliveryDate: '2026-09-22',
      cargo: { weightKg, palletSpaces }, priceEur: 500, source: 'email', status: 'new',
    } })
    expect(response.ok(), await response.text()).toBe(true)
    const result = await readJsonSafe<{ item: Offer }>(response)
    expect(result?.item.id).toBeTruthy()
    offerIds.push(result!.item.id)
    return result!.item
  }
  const createTransport = async () => {
    const response = await request.post('/api/logistics/transports', { data: {
      reference: `QA-TR-${stamp}-${transportIds.length}`, customer: `QA Customer ${stamp}`,
      origin: 'Warszawa', destination: 'Berlin', pickupDate: '2026-09-21', deliveryDate: '2026-09-22',
      order1: { id: `O1-${stamp}`, status: 'confirmed', cargo: { weightKg: 12000, palletSpaces: 20 } },
      order2: { id: `O2-${stamp}`, status: 'pending', carrier: `QA Carrier ${stamp}`,
        vehicle: { registration: 'QA-001', typeKey: 'logistics.dispatcher.vehicle.curtainsider', capacity: { weightKg: 18000, palletSpaces: 32 } } },
    } })
    expect(response.ok(), await response.text()).toBe(true)
    const result = await readJsonSafe<{ item: TransportDetail }>(response)
    expect(result?.item.order1.id).toBeTruthy()
    transportIds.push(result!.item.order1.id)
    return withAliases(result!.item)
  }
  return { createOffer, createTransport, cleanup }
}

export async function readTransport(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/logistics/transports/${id}`)
  expect(response.ok(), await response.text()).toBe(true)
  const result = await readJsonSafe<{ item: TransportDetail }>(response)
  expect(result?.item.order1.id).toBe(id)
  return withAliases(result!.item)
}

export async function decideTransport(request: APIRequestContext, transport: FixtureTransport, action: string, offerId?: string) {
  const response = await request.post(`/api/logistics/transports/${transport.id}/decision`, {
    headers: versionHeaders(transport), data: { action, transportVersion: transport.transportVersion, ...(offerId ? { offerId } : {}) },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const result = await readJsonSafe<{ item: TransportDetail }>(response)
  return withAliases(result!.item)
}
