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

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({ ...jest.requireActual('@open-mercato/shared/lib/commands/customFieldSnapshots'), loadCustomFieldSnapshot: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }))
jest.mock('../events', () => ({ emitLogisticsEvent: jest.fn() }))
jest.mock('../services/customerSource', () => ({ readCustomerSource: jest.fn() }))
jest.mock('../lib/customFields', () => ({ setTransactionalCustomFields: jest.fn() }))

type Row = TransportJob | CommandReceipt | CommandResultRecord
function fixture() {
  const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const place = { label: 'Depot', addressLine: '1 Depot St', city: 'Warsaw', countryCode: 'PL', timezone: 'Europe/Warsaw' }
  const input = { requestId: randomUUID(), customerId: randomUUID(), cargoDescription: 'Pallets', weightKg: '12.5', isPalletized: true, pallets: 1,
    pickupPlace: place, deliveryPlace: place, pickupWindowStart: '2026-09-20T08:00:00.000Z', pickupWindowEnd: '2026-09-20T10:00:00.000Z',
    deliveryWindowStart: '2026-09-20T12:00:00.000Z', deliveryWindowEnd: '2026-09-20T14:00:00.000Z', customFields: { priority: 'normal' } }
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
beforeEach(() => { jest.clearAllMocks(); registerModules([{ id: 'logistics', features }]) })

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
