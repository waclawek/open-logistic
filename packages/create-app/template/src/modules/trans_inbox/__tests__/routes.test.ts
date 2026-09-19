import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { randomUUID } from 'node:crypto'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { emitTransInboxEvent } from '../events'
import { GET, metadata as feedMetadata } from '../api/feed/route'
import { POST } from '../api/providers/[provider]/webhooks/[channel]/route'
import { listInboxRequests } from '../lib/inbox-store'
import { metadata as pageMetadata } from '../backend/page.meta'
import { setup } from '../setup'

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({ resolveOrganizationScopeForRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn(async () => ({})) }))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({ runRouteMutationGuards: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('@open-mercato/shared/lib/logger', () => ({ createLogger: () => ({ warn: jest.fn() }) }))
jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => undefined }))
jest.mock('../events', () => ({ emitTransInboxEvent: jest.fn(async () => undefined) }))

const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
const token = 'diagnostic-test-token-at-least-32-characters'
const originalEnv = process.env
const afterSuccess = jest.fn(async () => undefined)
const webhook = (secret = token, extraHeaders: Record<string, string> = {}, body = { test: true }) => new Request('http://localhost/api/integrations/trans/webhooks/freight', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trans-Inbox-Token': secret, ...extraHeaders }, body: JSON.stringify(body),
})
const routeContext = { params: { provider: 'trans', channel: 'freight' } }

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(resolveOrganizationScopeForRequest).mockImplementation(async ({ auth }) => ({ selectedId: auth?.orgId ?? null, tenantId: auth?.tenantId ?? null, filterIds: auth?.orgId ? [auth.orgId] : [], allowedIds: auth?.orgId ? [auth.orgId] : [] }))
  delete (globalThis as Record<string, unknown>).__openMercatoScopedTransInboxStore__
  process.env = { ...originalEnv, NODE_ENV: 'development', TRANS_INBOX_ENABLED: 'true', TRANS_INBOX_TOKEN: token, TRANS_INBOX_TENANT_ID: scope.tenantId, TRANS_INBOX_ORGANIZATION_ID: scope.organizationId }
  jest.mocked(getAuthFromRequest).mockResolvedValue({ sub: randomUUID(), tenantId: scope.tenantId, orgId: scope.organizationId })
  jest.mocked(runRouteMutationGuards).mockResolvedValue({ ok: true, runAfterSuccess: afterSuccess })
})

afterAll(() => { process.env = originalEnv })

it('requires authenticated feature-gated feed and admin setup', () => {
  expect(feedMetadata.GET).toEqual({ requireAuth: true, requireFeatures: ['trans_inbox.view'] })
  expect(pageMetadata.requireAuth).toBe(true)
  expect(pageMetadata.requireFeatures).toEqual(['trans_inbox.view'])
  expect(setup.defaultRoleFeatures).not.toHaveProperty('employee')
})

it('rejects missing auth and scope for feed', async () => {
  jest.mocked(getAuthFromRequest).mockResolvedValueOnce(null)
  expect((await GET(new Request('http://localhost/api/trans_inbox/feed'))).status).toBe(401)
  jest.mocked(getAuthFromRequest).mockResolvedValueOnce({ sub: 'user', tenantId: scope.tenantId, orgId: null })
  expect((await GET(new Request('http://localhost/api/trans_inbox/feed'))).status).toBe(400)
})

it('fails closed before reading a body when token or config is missing', async () => {
  const request = webhook('incorrect')
  expect((await POST(request, routeContext)).status).toBe(401)
  expect(request.bodyUsed).toBe(false)
  delete process.env.TRANS_INBOX_TOKEN
  expect((await POST(webhook(), routeContext)).status).toBe(503)
  expect(listInboxRequests(scope)).toEqual([])
})

it('ignores spoofed scope headers and broadcasts only an ID in trusted scope', async () => {
  const response = await POST(webhook(token, { 'X-Om-Tenant-Id': randomUUID(), 'X-Om-Organization-Id': randomUUID() }), routeContext)
  expect(response.status).toBe(202)
  const result = await response.json()
  expect(emitTransInboxEvent).toHaveBeenCalledWith('trans_inbox.request.received', { ...scope, id: result.id }, { ...scope, persistent: false })
  const feed = await GET(new Request('http://localhost/api/trans_inbox/feed'))
  expect(feed.headers.get('cache-control')).toBe('no-store')
  expect((await feed.json()).items).toHaveLength(1)
})

it('does not disclose captured requests to another tenant or organization', async () => {
  await POST(webhook(), routeContext)
  for (const auth of [
    { sub: 'other', tenantId: randomUUID(), orgId: scope.organizationId },
    { sub: 'other', tenantId: scope.tenantId, orgId: randomUUID() },
  ]) {
    jest.mocked(getAuthFromRequest).mockResolvedValueOnce(auth)
    const response = await GET(new Request('http://localhost/api/trans_inbox/feed?tenantId=' + scope.tenantId, { headers: { 'X-Om-Organization-Id': scope.organizationId } }))
    expect((await response.json()).items).toEqual([])
  }
})

it('respects guard veto and transformed payload before storing', async () => {
  jest.mocked(runRouteMutationGuards).mockResolvedValueOnce({ ok: false, errorStatus: 409, errorBody: { code: 'blocked' }, response: Response.json({ code: 'blocked' }, { status: 409 }) })
  expect((await POST(webhook(), routeContext)).status).toBe(409)
  expect(listInboxRequests(scope)).toEqual([])
  jest.mocked(runRouteMutationGuards).mockResolvedValueOnce({ ok: true, modifiedPayload: { safe: true, password: 'hidden' }, runAfterSuccess: afterSuccess })
  expect((await POST(webhook(), routeContext)).status).toBe(202)
  expect(listInboxRequests(scope)[0].body).toEqual({ safe: true, password: '[redacted]' })
  expect(afterSuccess).toHaveBeenCalledTimes(1)
})

it('rejects unsupported provider and malformed pagination', async () => {
  expect((await POST(webhook(), { params: { provider: 'unknown', channel: 'freight' } })).status).toBe(404)
  expect((await GET(new Request('http://localhost/api/trans_inbox/feed?limit=101'))).status).toBe(400)
})

it('rejects capture in production and does not reveal previous development data', async () => {
  await POST(webhook(), routeContext)
  process.env = { ...process.env, NODE_ENV: 'production' }
  expect((await POST(webhook(), routeContext)).status).toBe(503)
  expect((await (await GET(new Request('http://localhost/api/trans_inbox/feed'))).json()).items).toEqual([])
})

it('follows the validated organization selection for ordinary users and rejects forbidden selections', async () => {
  await POST(webhook(), routeContext)
  jest.mocked(getAuthFromRequest).mockResolvedValue({ sub: 'ordinary-user', tenantId: scope.tenantId, orgId: randomUUID() })
  jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValueOnce({ selectedId: scope.organizationId, tenantId: scope.tenantId, filterIds: [scope.organizationId], allowedIds: [scope.organizationId] })
  const response = await GET(new Request('http://localhost/api/trans_inbox/feed'))
  expect((await response.json()).items).toHaveLength(1)
  jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValueOnce({ selectedId: null, tenantId: scope.tenantId, filterIds: [], allowedIds: [], selectionRejected: true })
  expect((await GET(new Request('http://localhost/api/trans_inbox/feed'))).status).toBe(403)
})
