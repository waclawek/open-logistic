import { expect, test } from './helpers/fixtures'
import { createDispatcherFixtures, decideTransport, readTransport, versionHeaders } from './helpers/dispatcher'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test('database decisions allocate Order 3, 4 and 5, reject overflow and stale writes', async ({ page, logistics }) => {
  await logistics.authorizeApi()
  await logistics.prepareSales()
  await logistics.grant(['logistics.view', 'logistics.manage'])
  const fixtures = await createDispatcherFixtures(page.request)
  try {
    let transport = await fixtures.createTransport()
    expect(await logistics.readSalesOrder(transport.id)).toMatchObject({ id: transport.id })
    const stale = transport
    transport = await decideTransport(page.request, transport, 'approve_carrier')
    const conflict = await page.request.post(`/api/logistics/transports/${transport.id}/decision`, {
      headers: versionHeaders(stale), data: { action: 'reject_carrier' },
    })
    expect(conflict.status()).toBe(409)
    for (const orderNumber of [3, 4, 5]) {
      const offer = await fixtures.createOffer()
      transport = await decideTransport(page.request, transport, 'accept_load', offer.id)
      expect(transport.additionalLoads.find((load) => load.fields.transport_order_number === orderNumber)?.fields.transport_order_number).toBe(orderNumber)
    }
    const overflow = await fixtures.createOffer(1, 1)
    const refused = await page.request.post(`/api/logistics/transports/${transport.id}/decision`, {
      headers: versionHeaders(transport), data: { action: 'accept_load', offerId: overflow.id },
    })
    expect([400, 409, 422]).toContain(refused.status())
    const persisted = await readTransport(page.request, transport.id)
    expect(persisted.additionalLoads).toHaveLength(3)
    const rejected = await page.request.post(`/api/logistics/offers/${overflow.id}/decision`, {
      headers: versionHeaders(overflow), data: { action: 'reject' },
    })
    expect(rejected.ok()).toBe(true)
    await logistics.grant(['logistics.view'])
    const denied = await page.request.post(`/api/logistics/transports/${transport.id}/decision`, {
      headers: versionHeaders(persisted), data: { action: 'reject_carrier' },
    })
    expect(denied.status()).toBe(403)
  } finally {
    await logistics.grant(['logistics.view', 'logistics.manage'])
    await fixtures.cleanup()
  }
})

test('an offer can be accepted once across simultaneous transport decisions', async ({ page, logistics }) => {
  await logistics.authorizeApi()
  await logistics.prepareSales()
  await logistics.grant(['logistics.view', 'logistics.manage'])
  const fixtures = await createDispatcherFixtures(page.request)
  try {
    const first = await decideTransport(page.request, await fixtures.createTransport(), 'approve_carrier')
    const second = await decideTransport(page.request, await fixtures.createTransport(), 'approve_carrier')
    const offer = await fixtures.createOffer()
    const results = await Promise.all([first, second].map((transport) => page.request.post(`/api/logistics/transports/${transport.id}/decision`, {
      headers: versionHeaders(transport), data: { action: 'accept_load', offerId: offer.id },
    })))
    expect(results.filter((response) => response.ok())).toHaveLength(1)
    expect(results.filter((response) => [400, 409, 422].includes(response.status()))).toHaveLength(1)
    const persisted = await Promise.all([first, second].map((transport) => readTransport(page.request, transport.id)))
    expect(persisted.reduce((count, transport) => count + transport.additionalLoads.length, 0)).toBe(1)
  } finally {
    await fixtures.cleanup()
  }
})

test('offers and transports are isolated when switching organization', async ({ page, logistics, baseURL }) => {
  await logistics.authorizeApi()
  await logistics.prepareSales()
  const other = await logistics.addOrganization()
  await logistics.grant(['logistics.view', 'logistics.manage'], [logistics.organizationId, other.id])
  const fixtures = await createDispatcherFixtures(page.request)
  try {
    const offer = await fixtures.createOffer()
    const transport = await fixtures.createTransport()
    await page.context().addCookies([{ name: 'om_selected_org', value: other.id, url: baseURL!, sameSite: 'Lax' }])
    for (const [resource, record] of [['offers', offer], ['transports', transport]] as const) {
      const response = await page.request.get(`/api/logistics/${resource}?id=${record.id}`)
      expect(response.ok()).toBe(true)
      expect((await readJsonSafe<{ items: unknown[] }>(response))?.items).toEqual([])
    }
    const rejected = await page.request.post(`/api/logistics/offers/${offer.id}/decision`, {
      headers: versionHeaders(offer), data: { action: 'reject' },
    })
    expect(rejected.status()).toBe(409)
    const foreign = await page.request.post(`/api/logistics/transports/${transport.id}/decision`, {
      headers: versionHeaders(transport), data: { action: 'approve_carrier' },
    })
    expect(foreign.status()).toBe(409)
  } finally {
    await page.context().addCookies([{ name: 'om_selected_org', value: logistics.organizationId, url: baseURL!, sameSite: 'Lax' }])
    await fixtures.cleanup()
  }
})

test('rejected carriers and offers cannot allocate cargo; lists enforce pagination bounds', async ({ page, logistics }) => {
  await logistics.authorizeApi()
  await logistics.prepareSales()
  await logistics.grant(['logistics.view', 'logistics.manage'])
  const fixtures = await createDispatcherFixtures(page.request)
  try {
    const rejected = await decideTransport(page.request, await fixtures.createTransport(), 'reject_carrier')
    expect((await readTransport(page.request, rejected.id)).order2).toBeNull()
    expect((await readTransport(page.request, rejected.id)).carrierHistory[0]?.status).toBe('rejected')
    const offer = await fixtures.createOffer()
    const attempt = await page.request.post(`/api/logistics/transports/${rejected.id}/decision`, {
      headers: versionHeaders(rejected), data: { action: 'accept_load', offerId: offer.id },
    })
    expect([400, 409, 422]).toContain(attempt.status())
    const rejection = await page.request.post(`/api/logistics/offers/${offer.id}/decision`, {
      headers: versionHeaders(offer), data: { action: 'reject' },
    })
    expect(rejection.ok()).toBe(true)
    const active = await decideTransport(page.request, await fixtures.createTransport(), 'approve_carrier')
    const rejectedCargo = await page.request.post(`/api/logistics/transports/${active.id}/decision`, {
      headers: versionHeaders(active), data: { action: 'accept_load', offerId: offer.id },
    })
    expect([400, 409, 422]).toContain(rejectedCargo.status())
    const paged = await page.request.get('/api/logistics/transports?pageSize=1&page=1')
    const data = await readJsonSafe<{ items: unknown[]; total: number; totalPages: number }>(paged)
    expect(data?.items).toHaveLength(1)
    expect(data?.total).toBe(2)
    expect(data?.totalPages).toBe(2)
    const invalid = await page.request.get('/api/logistics/offers?pageSize=101')
    expect(invalid.status()).toBe(400)
  } finally {
    await fixtures.cleanup()
  }
})


test('direct Sales child edits and removals invalidate a loaded transport decision', async ({ page, logistics }) => {
  await logistics.authorizeApi()
  await logistics.prepareSales()
  await logistics.grant(['logistics.view', 'logistics.manage'])
  const fixtures = await createDispatcherFixtures(page.request)
  try {
    const initial = await fixtures.createTransport()
    await logistics.mutateSalesOrder('PUT', initial.order2!.id, { customFields: { carrier_cost: 950 } })
    const editedConflict = await page.request.post(`/api/logistics/transports/${initial.id}/decision`, {
      headers: versionHeaders(initial), data: { action: 'approve_carrier', transportVersion: initial.transportVersion },
    })
    expect(editedConflict.status()).toBe(409)
    let transport = await decideTransport(page.request, await readTransport(page.request, initial.id), 'approve_carrier')
    transport = await decideTransport(page.request, transport, 'accept_load', (await fixtures.createOffer()).id)
    await logistics.mutateSalesOrder('DELETE', transport.additionalLoads[0].id)
    const nextOffer = await fixtures.createOffer()
    const deletedConflict = await page.request.post(`/api/logistics/transports/${transport.id}/decision`, {
      headers: versionHeaders(transport), data: { action: 'accept_load', offerId: nextOffer.id, transportVersion: transport.transportVersion },
    })
    expect(deletedConflict.status()).toBe(409)
    const current = await readTransport(page.request, transport.id)
    expect(current.additionalLoads).toHaveLength(0)
    expect((await decideTransport(page.request, current, 'accept_load', nextOffer.id)).additionalLoads).toHaveLength(1)
  } finally {
    await fixtures.cleanup()
  }
})
