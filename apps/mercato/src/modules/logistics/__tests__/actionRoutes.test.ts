import { randomUUID } from 'node:crypto'
import { asValue, createContainer } from 'awilix'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readCommandReceipt } from '../commands/transaction'
import { POST } from '../api/jobs/[id]/accept/route'
import { POST as cancel } from '../api/jobs/[id]/cancel/route'
import { GET } from '../api/commands/[requestId]/route'
import { features } from '../acl'

jest.mock('@open-mercato/shared/lib/api/context', () => ({ resolveRequestContext: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }))
jest.mock('../commands/transaction', () => ({ readCommandReceipt: jest.fn() }))

function fixture() {
  const id = randomUUID()
  const requestId = randomUUID()
  const tenantId = randomUUID()
  const organizationId = randomUUID()
  const auth = { sub: randomUUID(), tenantId, orgId: organizationId }
  const scope = { tenantId, selectedId: organizationId as string | null, allowedIds: [organizationId], filterIds: [organizationId], selectionRejected: false }
  const acl = { features: ['logistics.*'], isSuperAdmin: false }
  const result = { action: 'logistics.jobs.accept', requestId, records: [{ entityType: 'logistics:transport_job', id, updatedAt: '2026-09-19T10:00:00.001Z' }] }
  const execute = jest.fn(async () => ({ result, logEntry: null }))
  const resolveFresh = jest.fn(async () => ({ scope, acl }))
  const container = createContainer()
  container.register({ commandBus: asValue({ execute }), organizationScopeService: asValue({ resolveForRequest: async () => scope, resolveFresh }) })
  jest.mocked(resolveRequestContext).mockResolvedValue({ ctx: { container, auth, translate: (key) => key } })
  const body = { requestId, expectedUpdatedAt: '2026-09-19T10:00:00.000Z' }
  const post = (input: unknown = body) => POST(new Request(`http://localhost/api/logistics/jobs/${id}/accept`, { method: 'POST', body: JSON.stringify(input) }), { params: { id } })
  const get = (query = 'action=logistics.jobs.accept') => GET(new Request(`http://localhost/api/logistics/commands/${requestId}?${query}`), { params: { requestId } })
  return { id, requestId, tenantId, organizationId, auth, scope, acl, result, execute, resolveFresh, container, body, post, get }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(readCommandReceipt).mockResolvedValue(null)
  registerModules([{ id: 'logistics', features }])
  registerMutationGuards([])
})
afterEach(() => registerMutationGuards([]))

function guard(overrides: Partial<MutationGuard>) {
  registerMutationGuards([{ moduleId: 'logistics', guards: [{ id: 'logistics.test', targetEntity: 'logistics.job', operations: ['update'], validate: async () => ({ ok: true }), ...overrides }] }])
}

describe('acceptance HTTP boundary', () => {
  it('uses fresh selected scope, command bus and no-store receipt response', async () => {
    const test = fixture()
    const response = await test.post()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual(test.result)
    expect(test.execute).toHaveBeenCalledWith('logistics.jobs.accept', { input: { ...test.body, id: test.id }, ctx: expect.objectContaining({ selectedOrganizationId: test.organizationId, auth: test.auth }) })
    expect(test.resolveFresh).toHaveBeenCalledWith(expect.objectContaining({ auth: { ...test.auth, isSuperAdmin: false } }))
  })
  it.each([null, {}, { requestId: randomUUID() }, { tenantId: randomUUID() }, { id: randomUUID() }])('rejects malformed or protected input %p', async (input) => {
    const test = fixture()
    expect((await test.post(input)).status).toBe(400)
    expect(test.execute).not.toHaveBeenCalled()
  })
  it('rejects null/all scope and revoked grants before guards or execution', async () => {
    const test = fixture()
    test.scope.selectedId = null
    expect((await test.post()).status).toBe(400)
    test.scope.selectedId = test.organizationId
    test.acl.features = ['logistics.view']
    expect((await test.post()).status).toBe(403)
    expect(test.execute).not.toHaveBeenCalled()
  })
  it('executes feature-gated registry guards with trusted scope and blocks mutations', async () => {
    const test = fixture()
    const validate = jest.fn(async () => ({ ok: false, status: 423, body: { error: 'locked' } }))
    guard({ features: ['logistics.jobs.manage'], validate })
    expect((await test.post()).status).toBe(423)
    expect(validate).toHaveBeenCalledWith(expect.objectContaining({ tenantId: test.tenantId, organizationId: test.organizationId, userId: test.auth.sub, resourceId: test.id }))
    expect(test.execute).not.toHaveBeenCalled()
  })
  it.each([{ status: 'ready' }, { id: randomUUID() }, { requestId: randomUUID() }, { expectedUpdatedAt: 'bad' }])('revalidates guard changes %p', async (modifiedPayload) => {
    const test = fixture()
    guard({ validate: async () => ({ ok: true, modifiedPayload }) })
    expect((await test.post()).status).toBe(400)
    expect(test.execute).not.toHaveBeenCalled()
  })
  it('runs callbacks only after successful command completion', async () => {
    const test = fixture()
    const calls: string[] = []
    guard({ validate: async () => ({ ok: true, shouldRunAfterSuccess: true }), afterSuccess: async () => { calls.push('after') } })
    test.execute.mockImplementation(async () => { calls.push('commit'); return { result: test.result, logEntry: null } })
    expect((await test.post()).status).toBe(200)
    expect(calls).toEqual(['commit', 'after'])
    calls.length = 0
    test.execute.mockRejectedValue(new CrudHttpError(409, { error: 'stale', code: 'conflict' }))
    const response = await test.post()
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'stale', code: 'conflict' })
    expect(calls).toEqual([])
  })
  it('does not expose internal command error data', async () => {
    const test = fixture()
    test.execute.mockRejectedValue(new Error('private cargo'))
    const response = await test.post()
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('private cargo')
  })
})

describe('cancellation HTTP boundary', () => {
  it('validates the reason, honors mutation guards and rejects guard identity changes', async () => {
    const test = fixture()
    const post = (body: unknown) => cancel(new Request(`http://localhost/api/logistics/jobs/${test.id}/cancel`, { method: 'POST', body: JSON.stringify(body) }), { params: { id: test.id } })
    const input = { ...test.body, reason: 'Customer request' }
    expect((await post(test.body)).status).toBe(400)
    guard({ validate: async () => ({ ok: false, status: 423, body: { error: 'locked' } }) })
    expect((await post(input)).status).toBe(423)
    guard({ validate: async () => ({ ok: true, modifiedPayload: { ...input, id: randomUUID() } }) })
    expect((await post(input)).status).toBe(400)
    guard({ validate: async () => ({ ok: true, modifiedPayload: { ...input, id: test.id, reason: 'Approved reason' } }) })
    test.result.action = 'logistics.jobs.cancel'
    const response = await post(input)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(test.execute).toHaveBeenCalledTimes(1)
    expect(test.execute).toHaveBeenCalledWith('logistics.jobs.cancel', expect.objectContaining({ input: { ...input, id: test.id, reason: 'Approved reason' } }))
  })
  it('replays an authorized cancellation without repeating guards or execution', async () => {
    const test = fixture()
    test.result.action = 'logistics.jobs.cancel'
    jest.mocked(readCommandReceipt).mockResolvedValue(test.result)
    const validate = jest.fn(async () => ({ ok: false, status: 423, body: { error: 'locked' } }))
    guard({ validate })
    const response = await cancel(new Request(`http://localhost/api/logistics/jobs/${test.id}/cancel`, { method: 'POST', body: JSON.stringify({ ...test.body, reason: 'Reason' }) }), { params: { id: test.id } })
    expect(response.status).toBe(200)
    expect(validate).not.toHaveBeenCalled()
    expect(test.execute).not.toHaveBeenCalled()
  })
})

describe('receipt HTTP boundary', () => {
  it.each([null, 'committed'])('returns %s without inferring failure from absence', async (state) => {
    const test = fixture()
    jest.mocked(readCommandReceipt).mockResolvedValue(state ? test.result : null)
    const response = await test.get()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ committed: Boolean(state), result: state ? test.result : null })
    expect(readCommandReceipt).toHaveBeenCalledWith(expect.objectContaining({ requestId: test.requestId, action: 'logistics.jobs.accept', requiredFeatures: ['logistics.jobs.manage'] }))
  })
  it.each(['', 'action=logistics.jobs.unknown', 'action=logistics.jobs.accept&action=logistics.jobs.accept', 'action=logistics.jobs.accept&tenantId=forged'])('rejects an ambiguous or unsupported lookup %s', async (query) => {
    const test = fixture()
    expect((await test.get(query)).status).toBe(400)
    expect(readCommandReceipt).not.toHaveBeenCalled()
  })
})
