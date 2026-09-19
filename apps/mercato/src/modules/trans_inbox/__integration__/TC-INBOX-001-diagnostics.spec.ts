import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, postForm } from '@open-mercato/core/helpers/integration/api'
import { createOrganizationFixture, createRoleFixture, createUserFixture, deleteOrganizationIfExists, deleteRoleIfExists, deleteUserIfExists, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['auth', 'directory'] }

test('TC-INBOX-001: anonymous feed and unauthenticated capture are rejected', async ({ request }) => {
  const feed = await request.get('/api/trans_inbox/feed')
  expect(feed.status()).toBe(401)
  const capture = await request.post('/api/integrations/trans/webhooks/freight', { data: { fixture: randomUUID() } })
  expect([401, 503]).toContain(capture.status())
})

test('TC-INBOX-002: isolated authorized user sees the separate diagnostic view and an empty scoped feed', async ({ request, page, baseURL }) => {
  const administrator = await getAuthToken(request, 'superadmin')
  const { tenantId } = getTokenContext(administrator)
  const stamp = randomUUID()
  let organizationId: string | null = null
  let roleId: string | null = null
  let userId: string | null = null
  try {
    organizationId = await createOrganizationFixture(request, administrator, { name: 'QA Inbox ' + stamp, tenantId })
    roleId = await createRoleFixture(request, administrator, { name: 'qa-inbox-' + stamp, tenantId })
    await setRoleAclFeatures(request, administrator, { roleId, features: ['trans_inbox.view'], organizations: [organizationId] })
    const email = 'qa-inbox-' + stamp + '@example.com'
    const password = 'Qa-' + randomUUID() + '!'
    userId = await createUserFixture(request, administrator, { email, password, organizationId, roles: [roleId] })
    const login = await postForm(page.request, '/api/auth/login', { email, password })
    expect(login.ok()).toBe(true)
    const loginResult = await readJsonSafe<{ token: string }>(login)
    expect(loginResult?.token).toBeTruthy()
    await page.context().setExtraHTTPHeaders({ Authorization: 'Bearer ' + loginResult!.token })
    await page.context().addCookies([
      { name: 'locale', value: 'en' },
      { name: 'om_selected_tenant', value: tenantId },
      { name: 'om_selected_org', value: organizationId },
      { name: 'om_demo_notice_ack', value: 'ack' },
      { name: 'om_cookie_notice_ack', value: 'ack' },
    ].map((cookie) => ({ ...cookie, url: baseURL!, sameSite: 'Lax' as const })))
    const feed = await page.request.get('/api/trans_inbox/feed', {
      headers: { 'X-Om-Organization-Id': process.env.TRANS_INBOX_ORGANIZATION_ID ?? randomUUID() },
    })
    expect(feed.status()).toBe(200)
    const data = await readJsonSafe<{ items: unknown[]; enabled: boolean }>(feed)
    expect(data?.items).toEqual([])
    expect(data?.enabled).toBe(false)
    await page.goto('/backend/trans_inbox')
    await expect(page.getByRole('heading', { name: 'Webhook diagnostics', exact: true })).toBeVisible()
    await expect(page.getByText('No diagnostic requests yet.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Clear', exact: true })).toHaveCount(0)

    await setRoleAclFeatures(request, administrator, { roleId, features: [], organizations: [organizationId] })
    const denied = await page.request.get('/api/trans_inbox/feed')
    expect(denied.status()).toBe(403)
  } finally {
    await deleteUserIfExists(request, administrator, userId)
    await deleteRoleIfExists(request, administrator, roleId)
    await deleteOrganizationIfExists(request, administrator, organizationId)
  }
})

test('TC-INBOX-003: configured development sink captures sanitized synthetic traffic', async ({ request }) => {
  test.skip(!process.env.TRANS_INBOX_TOKEN || !process.env.TRANS_INBOX_TENANT_ID || !process.env.TRANS_INBOX_ORGANIZATION_ID, 'Requires an explicitly configured local development diagnostic sink.')
  const administrator = await getAuthToken(request, 'superadmin')
  const fixture = randomUUID()
  const response = await request.post('/api/integrations/timocom/webhooks/freight-offer', {
    headers: {
      'X-Trans-Inbox-Token': process.env.TRANS_INBOX_TOKEN!,
      'Content-Type': 'application/vnd.freight-exchange.v3+json',
      'X-Om-Tenant-Id': randomUUID(),
    },
    data: { fixture, password: 'synthetic-secret' },
  })
  test.skip(response.status() === 503, 'The running application has development capture disabled.')
  expect(response.status()).toBe(202)
  const captured = await readJsonSafe<{ id: string }>(response)
  const feed = await apiRequest(request, 'GET', '/api/trans_inbox/feed', {
    token: administrator,
    headers: { Cookie: 'om_selected_tenant=' + process.env.TRANS_INBOX_TENANT_ID + '; om_selected_org=' + process.env.TRANS_INBOX_ORGANIZATION_ID },
  })
  expect(feed.status()).toBe(200)
  const result = await readJsonSafe<{ items: Array<{ id: string; body: { fixture: string; password: string } }> }>(feed)
  expect(result?.items.find((item) => item.id === captured?.id)?.body).toEqual({ fixture, password: '[redacted]' })
})
