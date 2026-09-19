import type { QueryEngine, QueryOptions, QueryResult } from '@open-mercato/shared/lib/query/types'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { getMergedAvailabilityWindows } from '@open-mercato/core/modules/planner/lib/availabilityMerge'
import { applyAclFeatureOverrides, resetModuleContractOverridesForTests } from '@open-mercato/shared/modules/overrides'
import { eligibilityResultSchema, type SourceSubject } from '../data/sourceAvailability'
import { createSourceAvailabilityService, type SourceReadContext } from '../services/sourceAvailability'

const identifier = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
const tenantId = identifier(1)
const organizationId = identifier(2)
const subject: SourceSubject = { subjectType: 'resource', subjectId: identifier(3) }
const ruleSetId = identifier(4)
const updatedAt = '2026-09-19T10:00:00.000Z'
const range = { start: new Date('2026-09-21T08:00:00Z'), end: new Date('2026-09-21T16:00:00Z') }
const context: SourceReadContext = {
  tenantId, organizationId,
  authorization: { grantedFeatures: ['logistics.view', 'resources.view', 'staff.view', 'planner.view'] },
}
const entityIds = {
  resources: { resources_resource: 'resources:resources_resource' },
  staff: { staff_team_member: 'staff:staff_team_member' },
  planner: { planner_availability_rule: 'planner:planner_availability_rule', planner_availability_rule_set: 'planner:planner_availability_rule_set' },
}
const masterEntity = entityIds.resources.resources_resource
const ruleEntity = entityIds.planner.planner_availability_rule
const ruleSetEntity = entityIds.planner.planner_availability_rule_set
const common = (id: string) => ({ id, tenant_id: tenantId, organization_id: organizationId, updated_at: updatedAt, deleted_at: null })
const master = (overrides: Record<string, unknown> = {}) => ({
  ...common(subject.subjectId), is_active: true, availability_rule_set_id: null, ...overrides,
})
const rule = (number = 10, overrides: Record<string, unknown> = {}) => ({
  ...common(identifier(number)), subject_type: 'resource', subject_id: subject.subjectId,
  timezone: 'UTC', rrule: 'DTSTART:20260921T080000Z;DURATION:PT8H;FREQ=DAILY', exdates: [], kind: 'availability', ...overrides,
})

function fixture() {
  const tables: Record<string, Record<string, unknown>[]> = {
    [masterEntity]: [master()], [entityIds.staff.staff_team_member]: [master()],
    [ruleEntity]: [rule()], [ruleSetEntity]: [common(ruleSetId)],
  }
  const query = jest.fn(async (entity: string, options?: QueryOptions): Promise<QueryResult<Record<string, unknown>>> => {
    const filters = options?.filters as Record<string, unknown>
    const matching = (tables[entity] ?? []).filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value))
      .filter((row) => row.deleted_at === null).sort((left, right) => String(left.id).localeCompare(String(right.id)))
    const page = options?.page?.page ?? 1
    const pageSize = options?.page?.pageSize ?? 100
    return { items: matching.slice((page - 1) * pageSize, page * pageSize), total: matching.length, page, pageSize }
  })
  const queryEngine: QueryEngine = { query: async <Row>(entity: string, options?: QueryOptions) => {
    const result = await query(entity, options)
    return { ...result, items: result.items as Row[] }
  } }
  const merge = jest.fn(getMergedAvailabilityWindows)
  const dependencies = { queryEngine, plannerAvailabilityService: { getMergedAvailabilityWindows: merge }, now: () => new Date(updatedAt) }
  return { tables, query, merge, dependencies, service: createSourceAvailabilityService(dependencies) }
}

beforeEach(() => registerEntityIds(entityIds))
afterEach(() => resetModuleContractOverridesForTests())

describe('authorized read-only source projections', () => {
  it.each([context.authorization.grantedFeatures, ['*'], ['logistics.*', 'resources.*', 'planner.*']].map((grantedFeatures) => ({ grantedFeatures })))('accepts current grants %j', async ({ grantedFeatures }) => {
    const { service, query } = fixture()
    const result = await service.evaluate({ ...context, authorization: { grantedFeatures } }, subject, range)
    expect(result.status).toBe('eligible')
    expect(eligibilityResultSchema.safeParse(result).success).toBe(true)
    expect(result).not.toHaveProperty('tripId')
    expect(result).not.toHaveProperty('id')
    for (const [, options] of query.mock.calls) {
      expect(options).toMatchObject({ tenantId, organizationId, filters: { tenant_id: tenantId, organization_id: organizationId },
        page: { pageSize: 100 }, skipAutoReindex: true, includeCustomFields: false, includeExtensions: false, withDeleted: false })
      expect(options?.fields).not.toEqual(expect.arrayContaining(['display_name', 'description', 'note', 'name']))
      expect(options).not.toHaveProperty('omitAutomaticTenantOrgScope')
    }
  })

  it.each([
    { grantedFeatures: [] },
    { grantedFeatures: ['logistics.view', 'resources.view'] },
    { grantedFeatures: ['logistics.view', 'planner.view', 'staff.view'] },
    { grantedFeatures: ['*'], scopeAllowed: false },
    { grantedFeatures: [], unrestricted: true, scopeAllowed: false },
  ])('denies before querying for %j', async (authorization) => {
    const { service, query } = fixture()
    expect(await service.evaluate({ ...context, authorization }, subject, range)).toMatchObject({ status: 'unknown', reasonCode: 'forbidden', sources: [], rules: [] })
    expect(query).not.toHaveBeenCalled()
  })

  it.each(['tenantId', 'organizationId'] as const)('rejects absent scope %s even for wildcard grants', async (field) => {
    const { service, query } = fixture()
    expect(await service.evaluate({ ...context, [field]: '' }, subject, range)).toMatchObject({ status: 'unknown', reasonCode: 'invalid_scope' })
    expect(query).not.toHaveBeenCalled()
  })

  it('uses the current staff grant and member subject', async () => {
    const { service, tables } = fixture()
    tables[ruleEntity] = [rule(10, { subject_type: 'member' })]
    const staffContext = { ...context, authorization: { grantedFeatures: ['logistics.view', 'staff.view', 'planner.view'] } }
    expect((await service.evaluate(staffContext, { ...subject, subjectType: 'member' }, range)).status).toBe('eligible')
    expect((await service.evaluate(staffContext, subject, range)).reasonCode).toBe('forbidden')
  })

  it('provides minimal authorized profile validation without planner permission', async () => {
    const { service } = fixture()
    const lookupContext = { ...context, authorization: { grantedFeatures: ['logistics.view', 'resources.view'] } }
    expect(await service.lookupSource(lookupContext, subject)).toEqual({ status: 'found', source: {
      ...subject, updatedAt, isActive: true, linkedRuleSetId: null,
    } })
    expect(await service.lookupSource({ ...context, authorization: { grantedFeatures: [] } }, subject)).toEqual({ status: 'unknown', reasonCode: 'forbidden' })
  })

  it.each(['tenant_id', 'organization_id'])('rejects a cross-scope %s row returned by a faulty projection', async (field) => {
    const { service, query, merge } = fixture()
    query.mockResolvedValueOnce({ items: [master({ [field]: identifier(999) })], total: 1, page: 1, pageSize: 100 })
    expect(await service.evaluate(context, subject, range)).toMatchObject({ status: 'unknown', reasonCode: 'invalid_source', sources: [] })
    expect(merge).not.toHaveBeenCalled()
  })

  it('does not find a master in another organization', async () => {
    const { service, tables } = fixture()
    tables[masterEntity] = [master({ organization_id: identifier(999) })]
    expect((await service.evaluate(context, subject, range)).reasonCode).toBe('source_missing')
  })

  it('respects removed ACL features even with unrestricted grants', async () => {
    const { service, query } = fixture()
    applyAclFeatureOverrides({ 'resources.view': null })
    expect((await service.evaluate({ ...context, authorization: { grantedFeatures: ['*'], unrestricted: true } }, subject, range)).reasonCode).toBe('forbidden')
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects cross-scope planner rules without exposing membership', async () => {
    const { service, query } = fixture()
    query.mockResolvedValueOnce({ items: [master()], total: 1, page: 1, pageSize: 100 })
      .mockResolvedValueOnce({ items: [rule(10, { tenant_id: identifier(999) })], total: 1, page: 1, pageSize: 100 })
    expect(await service.evaluate(context, subject, range)).toMatchObject({ status: 'unknown', reasonCode: 'invalid_source', memberships: [], rules: [] })
  })

  it.each([
    { deleted_at: updatedAt }, { is_active: false },
  ])('never grants eligibility to deleted or disabled masters %j', async (overrides) => {
    const { service, tables, merge } = fixture()
    tables[masterEntity] = [master(overrides)]
    expect((await service.evaluate(context, subject, range)).status).not.toBe('eligible')
    expect(merge).not.toHaveBeenCalled()
  })

  it('fails closed for absent registry, query engine, planner merger and query failures', async () => {
    const { service, dependencies, query } = fixture()
    expect((await createSourceAvailabilityService({}).evaluate(context, subject, range)).reasonCode).toBe('source_unavailable')
    expect((await createSourceAvailabilityService({ ...dependencies, plannerAvailabilityService: null }).evaluate(context, subject, range)).reasonCode).toBe('merger_unavailable')
    query.mockRejectedValueOnce(new Error('private database details'))
    expect((await service.evaluate(context, subject, range)).reasonCode).toBe('source_unavailable')
    registerEntityIds({})
    expect((await service.evaluate(context, subject, range)).reasonCode).toBe('source_unavailable')
  })
})

describe('complete rules and source observations', () => {
  it('reads 201 rules in pages of 100 and retains the final blocker', async () => {
    const { service, tables, query } = fixture()
    tables[ruleEntity] = Array.from({ length: 201 }, (_, index) => rule(index + 10, index === 200 ? { kind: 'unavailability' } : {}))
    const result = await service.evaluate(context, subject, range)
    expect(result.status).toBe('ineligible')
    expect(result.rules).toHaveLength(201)
    expect(result.memberships[0].ruleIds).toHaveLength(201)
    expect(query.mock.calls.filter(([entity]) => entity === ruleEntity).map(([, options]) => options?.page?.page)).toEqual([1, 2, 3])
  })

  it('never evaluates the successful prefix of a failed paginated read', async () => {
    const { service, tables, query, merge } = fixture()
    tables[ruleEntity] = Array.from({ length: 101 }, (_, index) => rule(index + 10))
    const original = query.getMockImplementation()!
    query.mockImplementation((entity, options) => options?.page?.page === 2 ? Promise.reject(new Error('unavailable')) : original(entity, options))
    expect(await service.evaluate(context, subject, range)).toMatchObject({ status: 'unknown', memberships: [], rules: [] })
    expect(merge).not.toHaveBeenCalled()
  })

  it.each(['partialIndexWarning', 'listCountCapWarning', 'encryptedSortRowCapWarning'])('rejects engine %s', async (warning) => {
    const { service, query } = fixture()
    query.mockResolvedValueOnce({ items: [master()], total: 1, page: 1, pageSize: 100, meta: { [warning]: { entity: masterEntity } } })
    expect((await service.evaluate(context, subject, range)).reasonCode).toBe('incomplete_source')
  })

  it.each(['short', 'duplicate', 'changed_total'])('rejects %s pagination', async (mode) => {
    const { service, query, tables, merge } = fixture()
    tables[ruleEntity] = Array.from({ length: 101 }, (_, index) => rule(index + 10))
    const original = query.getMockImplementation()!
    query.mockImplementation(async (entity, options) => {
      const result = await original(entity, options)
      if (entity !== ruleEntity) return result
      if (mode === 'short') return { ...result, items: result.items.slice(0, 20) }
      if (options?.page?.page !== 2) return result
      return mode === 'duplicate' ? { ...result, items: [rule(10)] } : { ...result, total: 102 }
    })
    expect((await service.evaluate(context, subject, range)).reasonCode).toBe('incomplete_source')
    expect(merge).not.toHaveBeenCalled()
  })

  it('custom rules override a linked ruleset without reading it', async () => {
    const { service, query, tables } = fixture()
    tables[masterEntity] = [master({ availability_rule_set_id: ruleSetId })]
    tables[ruleEntity].push(rule(11, { subject_type: 'ruleset', subject_id: ruleSetId, kind: 'unavailability' }))
    const result = await service.evaluate(context, subject, range)
    expect(result.status).toBe('eligible')
    expect(result.linkedRuleSetId).toBe(ruleSetId)
    expect(result.rules.map((item) => item.id)).toEqual([identifier(10)])
    expect(query.mock.calls.some(([entity]) => entity === ruleSetEntity)).toBe(false)
  })

  it('falls back only from empty custom membership and records both queries', async () => {
    const { service, tables } = fixture()
    tables[masterEntity] = [master({ availability_rule_set_id: ruleSetId })]
    tables[ruleEntity] = [rule(11, { subject_type: 'ruleset', subject_id: ruleSetId })]
    const result = await service.evaluate(context, subject, range)
    expect(result.status).toBe('eligible')
    expect(result.memberships).toEqual([
      { ...subject, ruleIds: [] }, { subjectType: 'ruleset', subjectId: ruleSetId, ruleIds: [identifier(11)] },
    ])
    expect(result.sources).toContainEqual({ entityType: ruleSetEntity, id: ruleSetId, updatedAt })
    tables[ruleSetEntity] = []
    expect((await service.evaluate(context, subject, range)).reasonCode).toBe('source_missing')
  })

  it('empty unlinked rules mean no coverage', async () => {
    const { service, tables } = fixture()
    tables[ruleEntity] = []
    expect(await service.evaluate(context, subject, range)).toMatchObject({ status: 'ineligible', reasonCode: 'no_availability' })
  })

  it('fingerprints are stable across checks and change for versions, membership, linkage and range', async () => {
    const { service, tables, dependencies } = fixture()
    const initial = await service.evaluate(context, subject, range)
    dependencies.now = () => new Date('2026-09-20T10:00:00Z')
    expect((await service.evaluate(context, subject, range)).fingerprint).toBe(initial.fingerprint)
    for (const entity of [masterEntity, ruleEntity]) {
      tables[entity][0].updated_at = '2026-09-20T10:00:00Z'
      expect((await service.evaluate(context, subject, range)).fingerprint).not.toBe(initial.fingerprint)
      tables[entity][0].updated_at = updatedAt
    }
    tables[ruleEntity].push(rule(11))
    expect((await service.evaluate(context, subject, range)).fingerprint).not.toBe(initial.fingerprint)
    tables[ruleEntity].pop()
    expect((await service.evaluate(context, subject, range)).fingerprint).toBe(initial.fingerprint)
    tables[masterEntity][0].availability_rule_set_id = ruleSetId
    expect((await service.evaluate(context, subject, range)).fingerprint).not.toBe(initial.fingerprint)
    tables[masterEntity][0].availability_rule_set_id = null
    expect((await service.evaluate(context, subject, { ...range, end: new Date('2026-09-21T15:00:00Z') })).fingerprint).not.toBe(initial.fingerprint)
  })

  it.each([
    { rrule: 'FREQ=MONTHLY' }, { rrule: 'DTSTART:20260921T080030Z;DURATION:PT8H;FREQ=DAILY' },
    { timezone: 'invalid' }, { exdates: ['not-a-date'] }, { kind: 'unsupported' },
  ])('rejects selected malformed rules %j before merger', async (overrides) => {
    const { service, tables, merge } = fixture()
    tables[ruleEntity].push(rule(11, overrides))
    expect(await service.evaluate(context, subject, range)).toMatchObject({ status: 'unknown', reasonCode: 'unsupported_rule', ruleIds: [identifier(11)] })
    expect(merge).not.toHaveBeenCalled()
  })

  it('retains bounded evaluator one-off/overnight rejection', async () => {
    const { service, tables, merge } = fixture()
    tables[ruleEntity] = [rule(10, { rrule: 'DTSTART:20260921T160000Z;DURATION:PT9H;FREQ=DAILY' }),
      rule(11, { rrule: 'DTSTART:20260922T000000Z;DURATION:PT24H;FREQ=DAILY;COUNT=1', kind: 'unavailability' })]
    expect((await service.evaluate(context, subject, range)).reasonCode).toBe('one_off_overnight')
    expect(merge).not.toHaveBeenCalled()
  })

  it('keeps all selected versions and membership when a rule projection is malformed', async () => {
    const { service, tables } = fixture()
    tables[ruleEntity] = [rule(10, { kind: 'malformed' }), rule(11)]
    const initial = await service.evaluate(context, subject, range)
    expect(initial.sources).toHaveLength(3)
    expect(initial.memberships[0].ruleIds).toEqual([identifier(10), identifier(11)])
    tables[ruleEntity][1].updated_at = '2026-09-20T10:00:00Z'
    expect((await service.evaluate(context, subject, range)).fingerprint).not.toBe(initial.fingerprint)
  })

  it('rejects invalid ranges before queries and never writes through dependencies', async () => {
    const { service, query, dependencies } = fixture()
    expect((await service.evaluate(context, subject, { start: range.end, end: range.start })).reasonCode).toBe('invalid_range')
    expect(query).not.toHaveBeenCalled()
    const write = jest.fn(() => { throw new Error('write forbidden') })
    Object.assign(dependencies.queryEngine, { create: write, update: write, delete: write, persist: write, flush: write })
    expect((await service.evaluate(context, subject, range)).status).toBe('eligible')
    expect(write).not.toHaveBeenCalled()
  })
})
