import { randomUUID } from 'node:crypto'
import { asValue, createContainer } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { QueryEngine, QueryResult } from '@open-mercato/shared/lib/query/types'
import type { LogisticsCommandContext } from '../commands/context'
import { readCustomerSource } from '../services/customerSource'
import { register } from '../di'
import type { createSourceAvailabilityService } from '../services/sourceAvailability'

const customerId = randomUUID()
const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
function fixture(features = ['customers.companies.view']) {
  const row = { id: customerId, tenant_id: scope.tenantId, organization_id: scope.organizationId, kind: 'company', display_name: 'Company', deleted_at: null }
  const query = jest.fn(async (): Promise<QueryResult<Record<string, unknown>>> => ({ items: [row], page: 1, pageSize: 1, total: 1 }))
  const engine: Pick<QueryEngine, 'query'> = { query: async <Row>() => {
    const result = await query()
    return { ...result, items: result.items as Row[] }
  } }
  const context: LogisticsCommandContext = {
    scope, actorUserId: randomUUID(), permissions: { grantedFeatures: features, unrestricted: false, scopeAllowed: true },
    translate: (key) => key,
    fail: (status, code): never => { throw new CrudHttpError(status, { error: code, code }) },
  }
  return { row, query, engine, context }
}

beforeEach(() => {
  registerModules([{ id: 'logistics' }, { id: 'customers' }, { id: 'resources' }, { id: 'planner' }])
  registerEntityIds({ customers: { customer_entity: 'customers:customer_entity' }, resources: { resources_resource: 'resources:resources_resource' } })
})

describe('authorized customer snapshots', () => {
  it.each([['customers.companies.view'], ['customers.*'], ['*']])('reads only a minimal snapshot for %s', async (feature) => {
    const test = fixture([feature])
    expect(await readCustomerSource(test.engine, test.context, customerId)).toEqual({ id: customerId, name: 'Company' })
  })
  it('requires the actual customer kind grant, even if the projection ignores the filter', async () => {
    const test = fixture(['customers.people.view'])
    await expect(readCustomerSource(test.engine, test.context, customerId)).rejects.toMatchObject({ status: 403 })
  })
  it('does not query without customer grants or a valid organization policy', async () => {
    const test = fixture([])
    await expect(readCustomerSource(test.engine, test.context, customerId)).rejects.toMatchObject({ status: 403 })
    test.context.permissions.grantedFeatures = ['*']
    test.context.permissions.scopeAllowed = false
    await expect(readCustomerSource(test.engine, test.context, customerId)).rejects.toMatchObject({ status: 403 })
    expect(test.query).not.toHaveBeenCalled()
  })
  it.each(['tenant_id', 'organization_id', 'id'])('rejects mismatched %s from a projection', async (field) => {
    const test = fixture()
    Reflect.set(test.row, field, randomUUID())
    await expect(readCustomerSource(test.engine, test.context, customerId)).rejects.toMatchObject({ status: 404 })
  })
  it('fails missing, deleted, duplicate and partial projections', async () => {
    const test = fixture()
    test.query.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 1 })
    await expect(readCustomerSource(test.engine, test.context, customerId)).rejects.toMatchObject({ status: 404 })
    test.query.mockResolvedValueOnce({ items: [{ ...test.row, deleted_at: new Date() }], total: 1, page: 1, pageSize: 1 })
    await expect(readCustomerSource(test.engine, test.context, customerId)).rejects.toMatchObject({ status: 404 })
    test.query.mockResolvedValueOnce({ items: [test.row], total: 2, page: 1, pageSize: 1 })
    await expect(readCustomerSource(test.engine, test.context, customerId)).rejects.toMatchObject({ status: 503 })
    test.query.mockResolvedValueOnce({ items: [test.row], total: 1, page: 1, pageSize: 1, meta: { listCountCapWarning: { entity: 'customers:customer_entity', cap: 1 } } })
    await expect(readCustomerSource(test.engine, test.context, customerId)).rejects.toMatchObject({ status: 503 })
  })
  it('reports an unavailable source module without inventing a name', async () => {
    const test = fixture()
    await expect(readCustomerSource(null, test.context, customerId)).rejects.toMatchObject({ status: 503 })
    registerEntityIds({})
    await expect(readCustomerSource(test.engine, test.context, customerId)).rejects.toMatchObject({ status: 503 })
  })
})

describe('optional source service DI', () => {
  it('constructs a request-scoped service when both optional dependencies are absent', async () => {
    const container = createContainer()
    register(container as AppContainer)
    const service = container.resolve<ReturnType<typeof createSourceAvailabilityService>>('logisticsSourceAvailabilityService')
    expect(await service.lookupSource({ ...scope, authorization: { grantedFeatures: ['*'] } }, { subjectType: 'resource', subjectId: randomUUID() }))
      .toEqual({ status: 'unknown', reasonCode: 'source_unavailable' })
  })
  it('resolves a scoped query engine and planner service without importing source entities', async () => {
    const container = createContainer()
    const queryEngine = { query: jest.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 100 })) }
    container.register({ queryEngine: asValue(queryEngine), plannerAvailabilityService: asValue({ getMergedAvailabilityWindows: () => [] }) })
    register(container as AppContainer)
    const service = container.resolve<ReturnType<typeof createSourceAvailabilityService>>('logisticsSourceAvailabilityService')
    const subjectId = randomUUID()
    expect(await service.lookupSource({ ...scope, authorization: { grantedFeatures: ['*'] } }, { subjectType: 'resource', subjectId }))
      .toEqual({ status: 'unknown', reasonCode: 'source_missing' })
    expect(queryEngine.query).toHaveBeenCalledWith('resources:resources_resource', expect.objectContaining({
      ...scope, filters: { id: subjectId, tenant_id: scope.tenantId, organization_id: scope.organizationId },
    }))
  })
})
