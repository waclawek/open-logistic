import { expect, test } from './helpers/fixtures'
import { createDispatcherFixtures, decideTransport, readTransport, versionHeaders } from './helpers/dispatcher'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

test('database decisions allocate Order 3, 4 and 5, reject overflow and stale writes', async ({ page, logistics }) => {
  await logistics.authorizeApi()
  await logistics.grant(['logistics.view', 'logistics.manage'])
  const fixtures = await createDispatcherFixtures(page.request)
  try {
    let transport = await fixtures.createTransport()
    const stale = transport
    transport = await decideTransport(page.request, transport, 'approve_carrier')
    const conflict = await page.request.post(`/api/logistics/transports/${transport.id}/decision`, {
      headers: versionHeaders(stale), data: { action: 'reject_carrier' },
    })
    expect(conflict.status()).toBe(409)
    for (const orderNumber of [3, 4, 5]) {
      const offer = await fixtures.createOffer()
      transport = await decideTransport(page.request, transport, 'accept_load', offer.id)
      expect(transport.additionalLoads.at(-1)?.orderNumber).toBe(orderNumber)
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
  await logistics.grant(['logistics.view', 'logistics.manage'])
  const fixtures = await createDispatcherFixtures(page.request)
  try {
    const rejected = await decideTransport(page.request, await fixtures.createTransport(), 'reject_carrier')
    expect((await readTransport(page.request, rejected.id)).order2?.status).toBe('rejected')
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
