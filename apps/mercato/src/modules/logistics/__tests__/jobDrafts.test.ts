import { randomUUID } from 'node:crypto'
import { asValue, createContainer } from 'awilix'
import type { CommandRuntimeContext, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { loadCustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { CommandReceipt, CommandResultRecord, TransportJob } from '../data/entities'
import { createJobCommand, updateJobCommand } from '../commands/jobDrafts'
import { setTransactionalCustomFields } from '../lib/customFields'
import { readCustomerSource } from '../services/customerSource'
import { features } from '../acl'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { createOptimisticLockGuardService } from '@open-mercato/shared/lib/crud/optimistic-lock'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { PUT, POST as createRoute } from '../api/jobs/route'
import { POST as acceptRoute } from '../api/jobs/[id]/accept/route'
import { acceptJobCommand } from '../commands/jobs'
import { readReceiptRequest } from '../lib/receiptRequest'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({ ...jest.requireActual('@open-mercato/shared/lib/commands/customFieldSnapshots'), loadCustomFieldSnapshot: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }))
jest.mock('../events', () => ({ emitLogisticsEvent: jest.fn() }))
jest.mock('../services/customerSource', () => ({ readCustomerSource: jest.fn() }))
jest.mock('../lib/customFields', () => ({ setTransactionalCustomFields: jest.fn() }))
jest.mock('@open-mercato/shared/lib/api/context', () => ({ resolveRequestContext: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({ resolveOrganizationScopeForRequest: jest.fn() }))

type Row = TransportJob | CommandReceipt | CommandResultRecord
function fixture() {
  const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const place = { label: 'Depot', addressLine: '1 Depot St', city: 'Warsaw', countryCode: 'PL', timezone: 'Europe/Warsaw' }
  const input = { requestId: randomUUID(), customerId: randomUUID(), cargoDescription: 'Pallets', weightKg: '12.5', isPalletized: true, pallets: 1,
    pickupPlace: place, deliveryPlace: place, pickupWindowStart: '2026-09-20T08:00:00.000Z', pickupWindowEnd: '2026-09-20T10:00:00.000Z',
    deliveryWindowStart: '2026-09-20T12:00:00.000Z', deliveryWindowEnd: '2026-09-20T14:00:00.000Z', customFields: { priority: 'normal' } as Record<string, unknown> }
  const rows: Row[] = []
  let before: Array<[Row, object]> = []
  const custom = new Map<string, Record<string, unknown>>()
  let beforeCustom = new Map<string, Record<string, unknown>>()
  let active = false
  const trace: string[] = []
  const em = {
    fork: jest.fn<unknown, []>(), isInTransaction: () => active, getTransactionContext: () => undefined,
    getConnection: () => ({ execute: jest.fn(async () => { expect(active).toBe(true); trace.push('receipt') }) }),
    begin: jest.fn(async () => { active = true; before = rows.map(row => [row, { ...row }]); beforeCustom = new Map(custom); trace.push('begin') }),
    flush: jest.fn(async () => { trace.push('flush') }),
    commit: jest.fn(async () => { active = false; trace.push('commit') }),
    rollback: jest.fn(async () => { rows.splice(0, rows.length, ...before.map(([row, values]) => Object.assign(row, values))); custom.clear(); for (const [id, values] of beforeCustom) custom.set(id, values); active = false }),
    create: <Entity extends object>(EntityClass: new () => Entity, values: object) => Object.assign(new EntityClass(), { id: randomUUID() }, values),
    persist: (row: Row) => { if (!rows.includes(row)) rows.push(row) },
  }
  em.fork.mockReturnValue(em)
  const fresh = { scope: { tenantId: scope.tenantId, selectedId: scope.organizationId, allowedIds: [scope.organizationId], filterIds: [scope.organizationId] }, acl: { isSuperAdmin: false, features: ['logistics.*'] } }
  const dataEngine = { markOrmEntityChange: jest.fn(), flushOrmEntityChanges: jest.fn(async () => { expect(active).toBe(false); trace.push('effects') }) }
  const container = createContainer().register({ em: asValue(em), organizationScopeService: asValue({ resolveFresh: async () => fresh }), dataEngine: asValue(dataEngine) })
  const ctx: CommandRuntimeContext = { container, auth: { sub: randomUUID(), tenantId: scope.tenantId, orgId: scope.organizationId }, selectedOrganizationId: scope.organizationId, organizationScope: null, organizationIds: [scope.organizationId] }
  jest.mocked(findOneWithDecryption).mockImplementation(async (_manager, entity, where) => {
    expect(where).toMatchObject({ tenantId: scope.tenantId, organizationId: ctx.selectedOrganizationId })
    return rows.find(row => row.constructor === entity && Object.entries(where).every(([key, value]) => Reflect.get(row, key) === value)) ?? null
  })
  jest.mocked(findWithDecryption).mockImplementation(async (_manager, entity, where) => rows.filter(row => row.constructor === entity && Object.entries(where).every(([key, value]) => Reflect.get(row, key) === value)))
  jest.mocked(readCustomerSource).mockResolvedValue({ id: input.customerId, name: 'Customer snapshot' })
  jest.mocked(loadCustomFieldSnapshot).mockImplementation(async (manager, options) => { expect(manager).toBe(em); return { ...custom.get(options.recordId) } })
  jest.mocked(setTransactionalCustomFields).mockImplementation(async options => {
    expect(options.em).toBe(em); expect(active).toBe(true); expect(trace.at(-1)).toBe('flush'); expect(options.scope).toEqual(scope)
    custom.set(options.recordId, { ...custom.get(options.recordId), ...options.values })
  })
  const job = () => rows.find((row): row is TransportJob => row instanceof TransportJob)!
  async function create() { return createJobCommand.execute(input, ctx) }
  async function log(command: typeof createJobCommand, result: Awaited<ReturnType<typeof create>>, raw: unknown = input): Promise<CommandUndoLogEntry> {
    const metadata = await command.buildLog!({ result, ctx, input: raw, snapshots: {} })
    return { id: randomUUID(), commandId: command.id, resourceId: job().id, commandPayload: metadata?.payload, snapshotBefore: metadata?.snapshotBefore, snapshotAfter: metadata?.snapshotAfter }
  }
  return { scope, input, rows, custom, em, trace, ctx, fresh, job, create, log }
}
beforeEach(() => { jest.clearAllMocks(); registerModules([{ id: 'logistics', features }]); registerMutationGuards([]) })
afterEach(() => registerMutationGuards([]))

it('creates a complete draft and customer snapshot atomically, then replays without another job', async () => {
  const test = fixture()
  const first = await test.create()
  expect(test.job()).toMatchObject({ status: 'draft', acceptedAt: null, customerNameSnapshot: 'Customer snapshot', pallets: 1 })
  expect(test.job()).not.toHaveProperty('requestId')
  expect(JSON.stringify(first)).not.toContain('Customer snapshot')
  expect(test.trace.indexOf('commit')).toBeLessThan(test.trace.indexOf('effects'))
  const replay = await test.create()
  expect(JSON.stringify(replay)).toBe(JSON.stringify(first))
  expect(await createJobCommand.buildLog!({ result: replay, ctx: test.ctx, input: test.input, snapshots: {} })).toMatchObject({ skipLog: true })
  expect(test.rows.filter(row => row instanceof TransportJob)).toHaveLength(1)
  expect(readCustomerSource).toHaveBeenCalledTimes(1)
})
it('rolls back the parent and receipt if custom fields fail', async () => {
  const test = fixture()
  jest.mocked(setTransactionalCustomFields).mockRejectedValueOnce(new Error('invalid custom field'))
  await expect(test.create()).rejects.toThrow('invalid custom field')
  expect(test.rows).toHaveLength(0)
  expect(test.em.rollback).toHaveBeenCalledTimes(1)
  expect(test.trace).not.toContain('effects')
})
it('serializes create receipts over custom field changes as well as base changes', async () => {
  const test = fixture(); await test.create()
  await expect(createJobCommand.execute({ ...test.input, customFields: { priority: 'urgent' } }, test.ctx)).rejects.toMatchObject({ status: 409 })
})
it.each(['ready', 'assigned', 'in_transit', 'delivered', 'returned', 'cancelled'] as const)('prevents ordinary editing of a %s job', async (status) => {
  const test = fixture(); await test.create(); test.job().status = status
  await expect(updateJobCommand.execute({ ...test.input, requestId: randomUUID(), id: test.job().id, expectedUpdatedAt: test.job().updatedAt.toISOString() }, test.ctx)).rejects.toMatchObject({ status: 409 })
})
it('updates a draft with its own version and restores base and custom fields on undo', async () => {
  const test = fixture(); await test.create()
  const raw = { ...test.input, requestId: randomUUID(), id: test.job().id, expectedUpdatedAt: test.job().updatedAt.toISOString(), cargoDescription: 'Updated', customFields: { priority: 'urgent' } }
  const result = await updateJobCommand.execute(raw, test.ctx)
  expect(test.job().cargoDescription).toBe('Updated')
  const logEntry = await test.log(updateJobCommand, result, raw)
  await updateJobCommand.undo!({ input: raw, ctx: test.ctx, logEntry })
  expect(test.job().cargoDescription).toBe('Pallets')
  expect(test.custom.get(test.job().id)).toEqual({ priority: 'normal' })
  await updateJobCommand.redo!({ input: raw, ctx: test.ctx, logEntry })
  expect(test.job().cargoDescription).toBe('Updated')
  expect(test.custom.get(test.job().id)).toEqual({ priority: 'urgent' })
})
it('soft-removes an unaccepted create on undo and restores the same ID on redo', async () => {
  const test = fixture(); const result = await test.create(); const id = test.job().id
  const logEntry = await test.log(createJobCommand, result)
  await createJobCommand.undo!({ input: test.input, ctx: test.ctx, logEntry })
  expect(test.job().deletedAt).toBeInstanceOf(Date)
  await createJobCommand.redo!({ input: test.input, ctx: test.ctx, logEntry })
  expect(test.job().id).toBe(id); expect(test.job().deletedAt).toBeNull()
})
it('rejects undo after acceptance, later edits or scope changes', async () => {
  const test = fixture(); const result = await test.create(); const logEntry = await test.log(createJobCommand, result)
  test.job().status = 'ready'
  await expect(createJobCommand.undo!({ input: test.input, ctx: test.ctx, logEntry })).rejects.toMatchObject({ status: 409 })
  test.job().status = 'draft'; test.job().updatedAt = new Date(test.job().updatedAt.getTime() + 1)
  await expect(createJobCommand.undo!({ input: test.input, ctx: test.ctx, logEntry })).rejects.toMatchObject({ status: 409 })
  test.fresh.scope.selectedId = randomUUID(); test.ctx.selectedOrganizationId = test.fresh.scope.selectedId; test.fresh.scope.allowedIds = [test.fresh.scope.selectedId]
  await expect(createJobCommand.undo!({ input: test.input, ctx: test.ctx, logEntry })).rejects.toMatchObject({ status: 404 })
})
it('rechecks current permissions on create and update and does not disclose a foreign customer', async () => {
  const test = fixture(); test.fresh.acl.features = ['logistics.view']
  await expect(test.create()).rejects.toMatchObject({ status: 403 })
  expect(readCustomerSource).not.toHaveBeenCalled()
  test.fresh.acl.features = ['logistics.*']; jest.mocked(readCustomerSource).mockRejectedValueOnce(new Error('missing source'))
  await expect(test.create()).rejects.toThrow('missing source'); expect(test.rows).toHaveLength(0)
})

it.each([
  [{ priority: 'normal' }, { priority: 'normal', extra: 'new' }],
  [{ priority: 'normal' }, { priority: null }],
  [{ priority: ['normal'] }, { priority: ['urgent', 'fragile'] }],
  [{ priority: ['normal'] }, { priority: [] }],
  [{ priority: 'normal' }, { extra: ['urgent', 'fragile'] }],
])('supports cleared and added custom fields through repeated undo/redo (%p to %p)', async (before, after) => {
  const test = fixture(); test.input.customFields = before
  await test.create()
  const raw = { ...test.input, requestId: randomUUID(), id: test.job().id, expectedUpdatedAt: test.job().updatedAt.toISOString(), customFields: after }
  const result = await updateJobCommand.execute(raw, test.ctx)
  const expected = { ...test.custom.get(test.job().id) }
  let logEntry = await test.log(updateJobCommand, result, raw)
  for (let cycle = 0; cycle < 2; cycle++) {
    await updateJobCommand.undo!({ input: raw, ctx: test.ctx, logEntry })
    const redone = await updateJobCommand.redo!({ input: raw, ctx: test.ctx, logEntry })
    expect(test.custom.get(test.job().id)).toEqual(expected)
    logEntry = await test.log(updateJobCommand, redone, raw)
  }
})

it('rejects redo after intervening edits even when the values return to the undone state', async () => {
  const test = fixture(); await test.create()
  const update = (cargoDescription: string) => updateJobCommand.execute({ ...test.input, id: test.job().id,
    requestId: randomUUID(), expectedUpdatedAt: test.job().updatedAt.toISOString(), cargoDescription }, test.ctx)
  const result = await update('Old edit')
  const logEntry = await test.log(updateJobCommand, result)
  await updateJobCommand.undo!({ input: test.input, ctx: test.ctx, logEntry })
  await update('Intervening edit'); await update('Pallets')
  const version = test.job().updatedAt.toISOString()
  await expect(updateJobCommand.redo!({ input: test.input, ctx: test.ctx, logEntry })).rejects.toMatchObject({ status: 409 })
  expect(test.job().cargoDescription).toBe('Pallets')
  expect(test.job().updatedAt.toISOString()).toBe(version)
})

it('requires a committed undo and tolerates numeric storage scale without discarding versions', async () => {
  const test = fixture(); const result = await test.create()
  const logEntry = await test.log(createJobCommand, result)
  expect(test.job().weightKg).toBe('12.500')
  test.job().weightKg = '12.5'
  await createJobCommand.undo!({ input: test.input, ctx: test.ctx, logEntry })
  const undoVersion = test.job().updatedAt.toISOString()
  await createJobCommand.undo!({ input: test.input, ctx: test.ctx, logEntry })
  expect(test.job().updatedAt.toISOString()).toBe(undoVersion)
  await expect(createJobCommand.redo!({ input: test.input, ctx: test.ctx, logEntry: { ...logEntry, id: randomUUID() } })).rejects.toMatchObject({ status: 409 })
  await createJobCommand.redo!({ input: test.input, ctx: test.ctx, logEntry })
  expect(test.job().weightKg).toBe('12.500')
})

async function httpFixture() {
  const test = fixture()
  await test.create()
  const container = test.ctx.container
  const commands = { 'logistics.jobs.create': createJobCommand, 'logistics.jobs.update': updateJobCommand, 'logistics.jobs.accept': acceptJobCommand }
  const execute = jest.fn(async (action: keyof typeof commands, options: { input: unknown, ctx: CommandRuntimeContext }) => ({
    result: await commands[action].execute(options.input, options.ctx), logEntry: null,
  }))
  const findOne = jest.fn(async (_entity: unknown, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => Reflect.get(test.job(), key) === value) ? test.job() : null)
  Object.assign(test.em, { findOne })
  container.register({ commandBus: asValue({ execute }),
    rbacService: asValue({ getGrantedFeatures: async () => test.fresh.acl.features }),
    organizationScopeService: asValue({ resolveForRequest: async () => test.fresh.scope, resolveFresh: async () => test.fresh }),
    crudMutationGuardService: asValue(createOptimisticLockGuardService({ getEm: () => test.em as unknown as EntityManager, envValue: 'all' })),
  })
  jest.mocked(createRequestContainer).mockResolvedValue(container)
  jest.mocked(resolveRequestContext).mockResolvedValue({ ctx: { container, auth: test.ctx.auth, translate: key => key } })
  jest.mocked(getAuthFromRequest).mockResolvedValue(test.ctx.auth)
  jest.mocked(resolveOrganizationScopeForRequest).mockResolvedValue(test.fresh.scope)
  const input = { ...test.input, requestId: randomUUID(), id: test.job().id, expectedUpdatedAt: test.job().updatedAt.toISOString(), cargoDescription: 'Edited over HTTP' }
  const put = (body = input) => PUT(new Request('http://localhost/api/logistics/jobs', { method: 'PUT',
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: body.expectedUpdatedAt }, body: JSON.stringify(body) }))
  const accept = () => acceptRoute(new Request(`http://localhost/api/logistics/jobs/${test.job().id}/accept`, { method: 'POST',
    body: JSON.stringify({ requestId: randomUUID(), expectedUpdatedAt: test.job().updatedAt.toISOString() }) }), { params: { id: test.job().id } })
  return { ...test, execute, input, put, accept, findOne }
}

it('replays a committed PUT before the real factory optimistic guard, with current authorization and exact input', async () => {
  const test = await httpFixture()
  const first = await test.put()
  expect(first.status).toBe(200)
  const original = await first.json()
  expect((await test.put()).status).toBe(200)
  expect(await (await test.put()).json()).toEqual(original)
  expect(test.execute).toHaveBeenCalledTimes(1)
  expect((await test.put({ ...test.input, cargoDescription: 'Changed reuse' })).status).toBe(409)
  expect((await test.put({ ...test.input, requestId: randomUUID() })).status).toBe(409)
  test.fresh.acl.features = ['logistics.view']
  expect((await test.put()).status).toBe(403)
  expect(test.execute).toHaveBeenCalledTimes(1)
})

it('uses one guard resource for real factory writes and acceptance, including legacy guards', async () => {
  const test = await httpFixture()
  const validate = jest.fn(async () => ({ ok: false, status: 423, body: { error: 'blocked' } }))
  registerMutationGuards([{ moduleId: 'logistics', guards: [{ id: 'test.job', targetEntity: 'logistics.job', operations: ['update'], features: ['logistics.jobs.manage'], validate }] }])
  expect((await test.put()).status).toBe(423)
  expect((await test.accept()).status).toBe(423)
  expect(validate).toHaveBeenCalledTimes(2)
  registerMutationGuards([])
  const validateMutation = jest.fn(async (_input: { resourceKind: string }) => ({ ok: false, status: 423, body: { error: 'legacy blocked' } }))
  test.ctx.container.register('crudMutationGuardService', asValue({ validateMutation, afterMutationSuccess: async () => {} }))
  expect((await test.put()).status).toBe(423)
  expect((await test.accept()).status).toBe(423)
  for (const [input] of validateMutation.mock.calls) expect(input.resourceKind).toBe('logistics.job')
  expect(test.execute).not.toHaveBeenCalled()
})

it('keeps the original HTTP identity when a guard transforms values, without replaying guards or callbacks', async () => {
  const test = await httpFixture()
  const validate = jest.fn(async () => ({ ok: true, modifiedPayload: { cargoDescription: 'Guard transformed' }, shouldRunAfterSuccess: true }))
  const afterSuccess = jest.fn(async () => {})
  registerMutationGuards([{ moduleId: 'logistics', guards: [{ id: 'test.transform', targetEntity: 'logistics.job', operations: ['update'], validate, afterSuccess }] }])
  expect((await test.put()).status).toBe(200)
  expect(test.job().cargoDescription).toBe('Guard transformed')
  expect((await test.put()).status).toBe(200)
  expect(test.execute).toHaveBeenCalledTimes(1)
  expect(validate).toHaveBeenCalledTimes(1)
  expect(afterSuccess).toHaveBeenCalledTimes(1)
  expect(readReceiptRequest(test.execute.mock.calls[0][1].ctx.request)).toBeNull()
})

it('recovers a receipt committed between the preliminary lookup and the factory guard', async () => {
  const test = await httpFixture()
  registerMutationGuards([{ moduleId: 'logistics', guards: [{ id: 'test.race', targetEntity: 'logistics.job', operations: ['update'],
    validate: async () => {
      await updateJobCommand.execute(test.input, test.ctx)
      return { ok: false, status: 409, body: { error: 'stale concurrent request' } }
    } }] }])
  const response = await test.put()
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ requestId: test.input.requestId, updatedAt: test.job().updatedAt.toISOString() })
  expect(test.execute).not.toHaveBeenCalled()
})

it.each(['id', 'requestId'])('rejects a guard changing the original HTTP %s', async key => {
  const test = await httpFixture()
  registerMutationGuards([{ moduleId: 'logistics', guards: [{ id: 'test.redirect', targetEntity: 'logistics.job', operations: ['update'],
    validate: async () => ({ ok: true, modifiedPayload: { [key]: randomUUID() } }) }] }])
  expect((await test.put()).status).toBe(400)
  expect(test.job().cargoDescription).toBe('Pallets')
})

it('retains POST receipt identity across custom-field normalization and runs create guards only once', async () => {
  const test = await httpFixture()
  const input = { ...test.input, requestId: randomUUID() }
  const body = { ...input } as Record<string, unknown>
  delete body.id; delete body.expectedUpdatedAt
  const validate = jest.fn(async () => ({ ok: true, modifiedPayload: { cargoDescription: 'Created through guard' }, shouldRunAfterSuccess: true }))
  const afterSuccess = jest.fn(async () => {})
  registerMutationGuards([{ moduleId: 'logistics', guards: [{ id: 'test.create', targetEntity: 'logistics.job', operations: ['create'], validate, afterSuccess }] }])
  const send = () => createRoute(new Request('http://localhost/api/logistics/jobs', { method: 'POST', body: JSON.stringify(body) }))
  const first = await send()
  expect(first.status).toBe(201)
  const replay = await send()
  expect(replay.status).toBe(201)
  expect(await replay.json()).toEqual(await first.json())
  expect(validate).toHaveBeenCalledTimes(1)
  expect(afterSuccess).toHaveBeenCalledTimes(1)
})
