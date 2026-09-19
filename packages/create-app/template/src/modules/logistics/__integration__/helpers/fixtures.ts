import { randomUUID } from 'node:crypto'
import { expect, test as base, type Page } from '@playwright/test'
import { apiRequest, getAuthToken, postForm } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import en from '../../i18n/en.json' with { type: 'json' }

export const menuSections = [
  { path: '/backend/logistics/ai-inbox', title: en['logistics.dispatcher.inbox'], tab: 'inbox' },
  { path: '/backend/logistics/transports', title: en['logistics.dispatcher.transports'], tab: 'transports' },
] as const

export const legacySections = [
  { path: '/backend/logistics/transport-jobs', title: 'Transport jobs' },
  { path: '/backend/logistics/fleet', title: 'Vehicles / drivers' },
  { path: '/backend/logistics/trips', title: 'Trips and routes' },
  { path: '/backend/logistics/map', title: 'Fleet map' },
  { path: '/backend/logistics/statistics', title: 'Statistics' },
  { path: '/backend/logistics/proposals-disruptions', title: 'Proposals and disruptions' },
] as const

export const sections = [menuSections[1], ...legacySections] as const

type LogisticsFixture = {
  authorizeApi: () => Promise<void>
  prepareSales: () => Promise<void>
  readSalesOrder: (id: string) => Promise<Record<string, unknown> | null>
  mutateSalesOrder: (method: 'PUT' | 'DELETE', id: string, data?: Record<string, unknown>) => Promise<void>
  organizationId: string
  organizationName: string
  addOrganization: () => Promise<{ id: string; name: string }>
  grant: (features: string[], organizations?: string[], secondary?: boolean) => Promise<void>
}

export const test = base.extend<{ logistics: LogisticsFixture }>({
  logistics: async ({ request, page, baseURL }, runFixture) => {
    expect(baseURL, 'The prepared integration environment must provide a base URL').toBeTruthy()
    const administratorToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(administratorToken)
    const stamp = randomUUID()
    const organizationName = `QA Logistics ${stamp}`
    const organizationIds: string[] = []
    const roleIds: string[] = []
    let userId: string | null = null
    const salesCleanup: Array<{ path: string; organizationId: string }> = []
    try {
      const organizationId = await createOrganizationFixture(request, administratorToken, {
        name: organizationName,
        tenantId,
      })
      organizationIds.push(organizationId)
      for (const suffix of ['primary', 'secondary']) {
        roleIds.push(await createRoleFixture(request, administratorToken, {
          name: `qa-logistics-${suffix}-${stamp}`,
          tenantId,
        }))
      }
      const grant = async (features: string[], organizations = [organizationId], secondary = false) => {
        await setRoleAclFeatures(request, administratorToken, {
          roleId: roleIds[secondary ? 1 : 0],
          features,
          organizations,
        })
      }
      await grant(['logistics.view', 'inbox_ops.proposals.view'])
      await grant([], [organizationId], true)
      const email = `qa-logistics-${stamp}@example.com`
      const password = `Qa-${randomUUID()}!`
      userId = await createUserFixture(request, administratorToken, {
        email,
        password,
        organizationId,
        roles: roleIds,
      })
      const loginResponse = await postForm(page.request, '/api/auth/login', { email, password })
      expect(loginResponse.ok(), 'The isolated logistics user should be able to sign in').toBe(true)
      const loginResult = await readJsonSafe<{ token: string }>(loginResponse)
      expect(loginResult?.token).toBeTruthy()
      await page.context().addCookies([
        { name: 'om_selected_tenant', value: tenantId },
        { name: 'om_selected_org', value: organizationId },
        { name: 'locale', value: 'en' },
        { name: 'om_demo_notice_ack', value: 'ack' },
        { name: 'om_cookie_notice_ack', value: 'ack' },
        { name: 'om_feedback_suppress', value: '1' },
      ].map((cookie) => ({ ...cookie, url: baseURL!, sameSite: 'Lax' as const })))
      const adminScopeHeaders = { Cookie: `om_selected_org=${organizationId}; om_selected_tenant=${tenantId}` }
      const prepareSales = async () => {
        const channelResponse = await apiRequest(request, 'POST', '/api/sales/channels', {
          token: administratorToken, headers: adminScopeHeaders,
          data: { name: `QA Logistics ${stamp}`, code: `qa-log-${stamp}`, isActive: true },
        })
        expect(channelResponse.ok(), await channelResponse.text()).toBe(true)
        const channel = await readJsonSafe<{ id: string }>(channelResponse)
        salesCleanup.push({ path: `/api/sales/channels?id=${channel!.id}`, organizationId })
        const listResponse = await apiRequest(request, 'GET', '/api/sales/order-statuses', {
          token: administratorToken, headers: adminScopeHeaders,
        })
        expect(listResponse.ok(), await listResponse.text()).toBe(true)
        const statusList = await readJsonSafe<{ items: Array<{ value: string }> }>(listResponse)
        for (const value of ['confirmed', 'pending_approval', 'approved', 'rejected']) {
          if (statusList?.items.some((item) => item.value === value)) continue
          const response = await apiRequest(request, 'POST', '/api/sales/order-statuses', {
            token: administratorToken, headers: adminScopeHeaders, data: { value, label: value },
          })
          expect(response.ok(), await response.text()).toBe(true)
        }
        const dictionariesResponse = await apiRequest(request, 'GET', '/api/dictionaries', {
          token: administratorToken, headers: adminScopeHeaders,
        })
        const dictionaries = await readJsonSafe<{ items: Array<{ id: string; key: string; organizationId: string }> }>(dictionariesResponse)
        for (const dictionary of dictionaries?.items ?? []) {
          if (dictionary.organizationId === organizationId && dictionary.key === 'sales.order_status') {
            salesCleanup.push({ path: `/api/dictionaries/${dictionary.id}`, organizationId })
          }
        }
      }
      await runFixture({
        prepareSales,
        readSalesOrder: async (id) => {
          const response = await apiRequest(request, 'GET', `/api/sales/orders?id=${id}`, {
            token: administratorToken, headers: adminScopeHeaders,
          })
          expect(response.ok(), await response.text()).toBe(true)
          const body = await readJsonSafe<{ items: Array<Record<string, unknown>> }>(response)
          return body?.items[0] ?? null
        },
        mutateSalesOrder: async (method, id, data) => {
          const currentResponse = await apiRequest(request, 'GET', `/api/sales/orders?id=${id}`, {
            token: administratorToken, headers: adminScopeHeaders,
          })
          const current = await readJsonSafe<{ items: Array<{ updatedAt?: string; updated_at?: string }> }>(currentResponse)
          const updatedAt = current?.items[0]?.updatedAt ?? current?.items[0]?.updated_at
          expect(updatedAt).toBeTruthy()
          const response = await apiRequest(request, method, `/api/sales/orders?id=${id}`, {
            token: administratorToken,
            headers: { ...adminScopeHeaders, [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt! },
            ...(method === 'PUT' ? { data: { id, ...data } } : {}),
          })
          expect(response.ok(), await response.text()).toBe(true)
        },
        authorizeApi: () => page.context().setExtraHTTPHeaders({ Authorization: `Bearer ${loginResult!.token}` }),
        organizationId,
        organizationName,
        grant,
        addOrganization: async () => {
          const name = `QA Logistics scope ${randomUUID()}`
          const id = await createOrganizationFixture(request, administratorToken, { name, tenantId })
          organizationIds.push(id)
          return { id, name }
        },
      })
    } finally {
      for (const target of salesCleanup.reverse()) {
        const headers = { Cookie: `om_selected_org=${target.organizationId}; om_selected_tenant=${tenantId}` }
        const currentResponse = await apiRequest(request, 'GET', target.path, { token: administratorToken, headers })
        const current = await readJsonSafe<{ updatedAt?: string; items?: Array<{ updatedAt: string }> }>(currentResponse)
        const updatedAt = current?.updatedAt ?? current?.items?.[0]?.updatedAt
        const response = await apiRequest(request, 'DELETE', target.path, {
          token: administratorToken, headers: { ...headers, ...(updatedAt ? { [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt } : {}) },
        })
        expect(response.ok(), `Cleanup ${target.path}: ${response.status()}`).toBe(true)
      }
      await deleteUserIfExists(request, administratorToken, userId)
      for (const roleId of roleIds) await deleteRoleIfExists(request, administratorToken, roleId)
      for (const organizationId of organizationIds.reverse()) {
        await deleteOrganizationIfExists(request, administratorToken, organizationId)
      }
    }
  },
})

export { expect }

export async function expectPlannedPage(page: Page, section: typeof sections[number] | typeof menuSections[number]): Promise<void> {
  const content = page.getByTestId('logistics-page')
  if ('tab' in section) {
    if (section.tab === 'inbox') {
      await expect(page).toHaveURL('/backend/inbox-ops')
      await expect(page.getByRole('heading', { name: 'AI Inbox Actions', exact: true })).toBeVisible()
      return
    }
    await expect(content.getByRole('heading', { name: section.title, exact: true })).toBeVisible()
    return
  }
  await expect(content.getByRole('heading', { name: section.title, exact: true })).toBeVisible()
  await expect(content.getByText('Planned feature', { exact: true })).toBeVisible()
}

export async function expectAccessDenied(page: Page): Promise<void> {
  await expect(page.getByText('You do not have permission to view this page. Please contact your administrator.', { exact: true })).toBeVisible()
  await expect(page.getByTestId('logistics-page')).toHaveCount(0)
  await expect(page.getByTestId('sidebar').getByRole('button', { name: 'Logistics', exact: true })).toHaveCount(0)
}
