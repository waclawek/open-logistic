import { randomUUID } from 'node:crypto'
import { asValue, createContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { reportError } from '@open-mercato/telemetry'
import { CommandReceipt, CommandResultRecord, TransportJob } from '../data/entities'
import { acceptJobCommand } from '../commands/jobs'
import { authorizeLogisticsCommand } from '../commands/context'
import { readCommandReceipt } from '../commands/transaction'
import { digestCommandInput } from '../lib/commandInput'
import { nextRecordVersion, requireRecordVersion } from '../lib/version'
import { emitLogisticsEvent } from '../events'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { features } from '../acl'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }))
jest.mock('../events', () => ({ emitLogisticsEvent: jest.fn() }))

const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
const actorUserId = randomUUID()
const initialVersion = '2026-09-19T10:00:00.000Z'
const place = { label: 'Depot', addressLine: '1 Depot St', city: 'Warsaw', countryCode: 'PL', timezone: 'Europe/Warsaw' }

function harness() {
  const job = Object.assign(new TransportJob(), {
    ...scope, id: randomUUID(), reference: 'T1', customerId: randomUUID(), customerNameSnapshot: 'Customer',
    cargoDescription: 'Pallets', weightKg: '12.500', isPalletized: true, pallets: 1, pickupPlace: place, deliveryPlace: place,
    pickupWindowStart: new Date('2026-09-20T08:00:00Z'), pickupWindowEnd: new Date('2026-09-20T10:00:00Z'),
    deliveryWindowStart: new Date('2026-09-20T12:00:00Z'), deliveryWindowEnd: new Date('2026-09-20T14:00:00Z'),
    updatedAt: new Date(initialVersion),
  })
  const rows: Array<CommandReceipt | CommandResultRecord> = []
  const staged: Array<CommandReceipt | CommandResultRecord> = []
  const trace: string[] = []
  const transaction = {}
  let active = false
  let before = { ...job }
  const em = {
    fork: jest.fn<unknown, []>(),
    isInTransaction: () => active,
    getTransactionContext: () => transaction,
    getConnection: () => ({ execute: jest.fn(async (sql: string, params: unknown[], method: string, context: unknown) => {
      expect(sql).toBe('select pg_advisory_xact_lock(hashtextextended(?, 0))')
      expect(params).toHaveLength(1)
      expect(context).toBe(transaction)
      expect(active).toBe(true)
      trace.push('receipt-lock')
    }) }),
    begin: jest.fn(async () => { active = true; before = { ...job }; trace.push('begin') }),
    flush: jest.fn(async () => { trace.push('flush') }),
    commit: jest.fn(async () => { rows.push(...staged); staged.length = 0; active = false; trace.push('commit') }),
    rollback: jest.fn(async () => { Object.assign(job, before); staged.length = 0; active = false; trace.push('rollback') }),
    create: <Entity extends object>(EntityClass: new () => Entity, input: object) => Object.assign(new EntityClass(), { id: randomUUID() }, input),
    persist: (entity: CommandReceipt | CommandResultRecord) => staged.push(entity),
  }
  em.fork.mockReturnValue(em)
  const fresh = {
    scope: { ...scope, tenantId: scope.tenantId, selectedId: scope.organizationId, filterIds: [scope.organizationId], allowedIds: [scope.organizationId], selectionRejected: false },
    acl: { isSuperAdmin: false, features: ['logistics.*'], organizations: [scope.organizationId] },
  }
  const resolveFresh = jest.fn(async () => fresh)
  const dataEngine = { markOrmEntityChange: jest.fn(), flushOrmEntityChanges: jest.fn(async () => { trace.push('effects'); expect(active).toBe(false) }) }
  const container = createContainer().register({ em: asValue(em), organizationScopeService: asValue({ resolveFresh }), dataEngine: asValue(dataEngine) })
  const ctx: CommandRuntimeContext = { container, auth: { sub: actorUserId, tenantId: scope.tenantId, orgId: scope.organizationId }, organizationScope: null, selectedOrganizationId: scope.organizationId, organizationIds: [scope.organizationId] }
  jest.mocked(findOneWithDecryption).mockImplementation(async (_manager, entity, where, options) => {
    const filter = where as Record<string, unknown>
    expect(filter.tenantId).toBe(scope.tenantId)
    expect(filter.organizationId).toBe(scope.organizationId)
    if (entity === TransportJob) {
      trace.push('job-lock')
      expect(options).toMatchObject({ refresh: true })
      return filter.id === job.id && job.deletedAt === null ? job : null
    }
    if (entity === CommandReceipt) return rows.find((row) => row instanceof CommandReceipt && Object.entries(filter).every(([key, value]) => Reflect.get(row, key) === value)) ?? null
    throw new Error('Unexpected entity')
  })
  jest.mocked(findWithDecryption).mockImplementation(async (_manager, _entity, where) => {
    const filter = where as Record<string, unknown>
    expect(filter).toMatchObject(scope)
    return rows.filter((row) => row instanceof CommandResultRecord && row.receiptId === filter.receiptId)
  })
  return { job, rows, trace, em, fresh, resolveFresh, dataEngine, ctx, input: { id: job.id, expectedUpdatedAt: initialVersion, requestId: randomUUID() } }
}

beforeEach(() => {
  jest.clearAllMocks()
  registerModules([{ id: 'logistics', features }])
})

describe('command input identity and mandatory versions', () => {
  it('canonicalizes object order but preserves ordered work, nulls and changed values', () => {
    expect(digestCommandInput({ b: [1, 2], a: { y: null, x: 'cargo' } })).toBe(digestCommandInput({ a: { x: 'cargo', y: null }, b: [1, 2], omitted: undefined }))
    expect(digestCommandInput([1, 2])).not.toBe(digestCommandInput([2, 1]))
    expect(digestCommandInput({ a: null })).not.toBe(digestCommandInput({}))
    expect(() => digestCommandInput({ number: Infinity })).toThrow()
  })
  it('does not permit the global compatibility switch to disable domain versions', () => {
    const previous = process.env.OM_OPTIMISTIC_LOCK
    process.env.OM_OPTIMISTIC_LOCK = 'off'
    try {
      expect(() => requireRecordVersion('logistics:transport_job', { id: randomUUID(), updatedAt: new Date(initialVersion) }, '2026-09-19T09:59:59Z')).toThrow(expect.objectContaining({ status: 409 }))
      expect(() => requireRecordVersion('logistics:transport_job', { id: randomUUID(), updatedAt: new Date(initialVersion) }, '')).toThrow()
    } finally { if (previous === undefined) delete process.env.OM_OPTIMISTIC_LOCK; else process.env.OM_OPTIMISTIC_LOCK = previous }
  })
  it('advances versions within the same millisecond or after a clock rollback', () => {
    expect(nextRecordVersion(new Date(initialVersion), new Date(initialVersion)).toISOString()).toBe('2026-09-19T10:00:00.001Z')
    expect(nextRecordVersion(new Date(initialVersion), new Date('2026-09-18')).toISOString()).toBe('2026-09-19T10:00:00.001Z')
  })
})

describe('receipted job acceptance', () => {
  it('commits job and receipt before effects, then replays the original version without new effects', async () => {
    const test = harness()
    const result = await acceptJobCommand.execute(test.input, test.ctx)
    expect(test.job.status).toBe('ready')
    expect(test.rows).toHaveLength(2)
    expect(test.trace.indexOf('receipt-lock')).toBeLessThan(test.trace.indexOf('job-lock'))
    expect(test.trace.indexOf('commit')).toBeLessThan(test.trace.indexOf('effects'))
    test.job.updatedAt = new Date('2026-09-21T00:00:00Z')
    expect(await acceptJobCommand.execute(test.input, test.ctx)).toEqual(result)
    expect(test.rows).toHaveLength(2)
    expect(emitLogisticsEvent).toHaveBeenCalledTimes(1)
    expect(await readCommandReceipt({ ctx: test.ctx, action: 'logistics.jobs.accept', requestId: test.input.requestId, requiredFeatures: ['logistics.jobs.manage'] })).toEqual(result)
  })
  it('rejects reusing a request ID with changed validated input', async () => {
    const test = harness()
    await acceptJobCommand.execute(test.input, test.ctx)
    await expect(acceptJobCommand.execute({ ...test.input, expectedUpdatedAt: test.job.updatedAt.toISOString() }, test.ctx)).rejects.toMatchObject({ status: 409, body: { code: 'requestIdReused' } })
    expect(test.rows).toHaveLength(2)
  })
  it('does not replay after permission revocation', async () => {
    const test = harness()
    await acceptJobCommand.execute(test.input, test.ctx)
    test.fresh.acl.features = ['logistics.view']
    await expect(acceptJobCommand.execute(test.input, test.ctx)).rejects.toMatchObject({ status: 403 })
    await expect(readCommandReceipt({ ctx: test.ctx, action: 'logistics.jobs.accept', requestId: test.input.requestId, requiredFeatures: ['logistics.jobs.manage'] })).rejects.toMatchObject({ status: 403 })
    expect(test.em.begin).toHaveBeenCalledTimes(1)
  })
  it('rolls back job state and stages no successful receipt when the second flush fails', async () => {
    const test = harness()
    test.em.flush.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('DB failure'))
    await expect(acceptJobCommand.execute(test.input, test.ctx)).rejects.toThrow('DB failure')
    expect(test.job.status).toBe('draft')
    expect(test.job.acceptedAt).toBeNull()
    expect(test.rows).toHaveLength(0)
    expect(emitLogisticsEvent).not.toHaveBeenCalled()
    expect(test.em.rollback).toHaveBeenCalledTimes(1)
  })
  it('keeps a committed outcome when postcommit effects fail', async () => {
    const test = harness()
    test.dataEngine.flushOrmEntityChanges.mockRejectedValueOnce(new Error('Indexer failed'))
    await expect(acceptJobCommand.execute(test.input, test.ctx)).resolves.toMatchObject({ requestId: test.input.requestId })
    expect(test.rows).toHaveLength(2)
    expect(test.em.rollback).not.toHaveBeenCalled()
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ code: 'logistics.postcommit_failed' }))
  })
  it.each(['ready', 'assigned', 'in_transit', 'delivered', 'returned', 'cancelled'] as const)('rejects accepting %s jobs with a fresh request', async (status) => {
    const test = harness()
    test.job.status = status
    await expect(acceptJobCommand.execute(test.input, test.ctx)).rejects.toMatchObject({ status: 409, body: { code: 'jobNotDraft' } })
    expect(test.rows).toHaveLength(0)
  })
  it('fails stale versions and missing records before mutation', async () => {
    const test = harness()
    await expect(acceptJobCommand.execute({ ...test.input, expectedUpdatedAt: '2026-09-18T00:00:00Z' }, test.ctx)).rejects.toMatchObject({ status: 409 })
    await expect(acceptJobCommand.execute({ ...test.input, id: randomUUID() }, test.ctx)).rejects.toMatchObject({ status: 404 })
    expect(test.job.status).toBe('draft')
    expect(test.rows).toHaveLength(0)
  })
  it('rejects caller-owned transactions before taking locks or emitting effects', async () => {
    const test = harness()
    await test.em.begin()
    await expect(acceptJobCommand.execute(test.input, test.ctx)).rejects.toMatchObject({ status: 409, body: { code: 'nestedCommand' } })
    expect(test.trace).toEqual(['begin'])
    expect(test.rows).toHaveLength(0)
  })
})

describe('command authorization', () => {
  it('does not pass stale superadministrator claims to the fresh scope resolver', async () => {
    const test = harness()
    await authorizeLogisticsCommand({ ...test.ctx, auth: { ...test.ctx.auth!, isSuperAdmin: true } }, [])
    expect(test.resolveFresh).toHaveBeenCalledWith(expect.objectContaining({ auth: expect.objectContaining({ sub: actorUserId, isSuperAdmin: false }) }))
  })
  it('rejects API-key actors for the internal-user operational release', async () => {
    const test = harness()
    const keyId = randomUUID()
    await expect(authorizeLogisticsCommand({ ...test.ctx, auth: { sub: `api_key:${keyId}`, keyId, userId: actorUserId, isApiKey: true, tenantId: scope.tenantId, orgId: scope.organizationId } }, ['logistics.jobs.manage'])).rejects.toMatchObject({ status: 403 })
    expect(test.resolveFresh).not.toHaveBeenCalled()
  })
  it('requires explicit organization selection even when the actor organization is available', async () => {
    const test = harness()
    for (const actorTenantId of [scope.tenantId, randomUUID()]) {
      await expect(authorizeLogisticsCommand({ ...test.ctx, selectedOrganizationId: null,
        auth: { sub: actorUserId, tenantId: scope.tenantId, orgId: null, actorOrgId: scope.organizationId, actorTenantId, isSuperAdmin: true } }, []))
        .rejects.toMatchObject({ status: 400, body: { code: 'organization_scope_required' } })
    }
    expect(test.resolveFresh).not.toHaveBeenCalled()
  })
  it('rejects missing authentication, unresolved organization and rejected organization selection', async () => {
    const test = harness()
    await expect(authorizeLogisticsCommand({ ...test.ctx, auth: null }, [])).rejects.toMatchObject({ status: 401 })
    await expect(authorizeLogisticsCommand({ ...test.ctx, selectedOrganizationId: null, auth: { sub: actorUserId, tenantId: scope.tenantId, orgId: null } }, [])).rejects.toMatchObject({ status: 400 })
    test.fresh.scope.selectionRejected = true
    await expect(authorizeLogisticsCommand(test.ctx, [])).rejects.toMatchObject({ status: 403 })
  })
  it('honors both an earlier rejected selection and the freshly resolved allowed set', async () => {
    const test = harness()
    await expect(authorizeLogisticsCommand({ ...test.ctx, organizationScope: { ...test.fresh.scope, selectionRejected: true } }, [])).rejects.toMatchObject({ status: 403 })
    test.fresh.scope.allowedIds = [randomUUID()]
    await expect(authorizeLogisticsCommand(test.ctx, [])).rejects.toMatchObject({ status: 403 })
  })
  it('does not let stale wildcard grants reopen a disabled module', async () => {
    const test = harness()
    registerModules([])
    await expect(authorizeLogisticsCommand(test.ctx, [])).rejects.toMatchObject({ status: 403 })
  })
})
