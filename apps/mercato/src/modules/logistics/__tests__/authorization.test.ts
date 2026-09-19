import { randomUUID } from 'node:crypto'
import { asValue, createContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { DefaultOrganizationScopeService } from '@open-mercato/core/modules/directory/services/organizationScopeService'
import { authorizeLogisticsCommand } from '../commands/context'
import { readCommandReceipt } from '../commands/transaction'
import { features } from '../acl'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }))
jest.mock('@open-mercato/cache', () => ({ getCurrentCacheTenant: () => null, runWithCacheTenant: (_tenant: string, operation: () => unknown) => operation() }))

beforeEach(() => registerModules([{ id: 'logistics', features }]))

function fixture() {
  const tenantId = randomUUID()
  const organizationA = randomUUID()
  const organizationB = randomUUID()
  const rows = [{ id: organizationA, descendantIds: [] as string[] }, { id: organizationB, descendantIds: [] as string[] }]
  const acl = { isSuperAdmin: true, features: ['logistics.*'], organizations: null as string[] | null }
  const invalidateUserCache = jest.fn(async () => undefined)
  const em = { find: jest.fn(async (_entity: unknown, where: { tenant: string; id: { $in: string[] }; deletedAt: null }) => {
    expect(where.tenant).toBe(tenantId)
    expect(where.deletedAt).toBeNull()
    return rows.filter((row) => where.id.$in.includes(row.id))
  }) }
  const container = createContainer()
  const resolver = new DefaultOrganizationScopeService(em as unknown as EntityManager, { invalidateUserCache, loadAcl: async () => acl }, container)
  container.register({ organizationScopeService: asValue(resolver) })
  const ctx: CommandRuntimeContext = {
    container, auth: { sub: randomUUID(), tenantId, orgId: organizationA, isSuperAdmin: true },
    selectedOrganizationId: organizationB, organizationScope: null, organizationIds: [organizationB],
  }
  return { tenantId, organizationA, organizationB, rows, acl, ctx, invalidateUserCache }
}

describe('logistics authorization through the actual directory scope service', () => {
  it('revokes stale administrator organization access for mutations and receipt replay', async () => {
    const test = fixture()
    expect((await authorizeLogisticsCommand(test.ctx, ['logistics.jobs.manage'])).scope.organizationId).toBe(test.organizationB)
    test.acl.isSuperAdmin = false
    test.acl.organizations = [test.organizationA]
    await expect(authorizeLogisticsCommand(test.ctx, ['logistics.jobs.manage'])).rejects.toMatchObject({ status: 403 })
    await expect(readCommandReceipt({ ctx: test.ctx, action: 'logistics.jobs.accept', requestId: randomUUID(), requiredFeatures: ['logistics.jobs.manage'] })).rejects.toMatchObject({ status: 403 })
    expect(test.invalidateUserCache).toHaveBeenCalledTimes(3)
  })

  it('preserves explicitly selected descendant organizations granted by current ACL', async () => {
    const test = fixture()
    test.acl.isSuperAdmin = false
    test.acl.organizations = [test.organizationA]
    test.rows[0].descendantIds = [test.organizationB]
    expect((await authorizeLogisticsCommand(test.ctx, ['logistics.jobs.manage'])).scope.organizationId).toBe(test.organizationB)
  })

  it('rejects a selected organization that no longer exists', async () => {
    const test = fixture()
    test.rows.pop()
    await expect(authorizeLogisticsCommand(test.ctx, [])).rejects.toMatchObject({ status: 403 })
  })

  it('never turns the all-organizations selection into the actor organization', async () => {
    const test = fixture()
    test.ctx.selectedOrganizationId = null
    test.ctx.auth = { ...test.ctx.auth!, orgId: null, actorOrgId: test.organizationA, actorTenantId: test.tenantId }
    await expect(authorizeLogisticsCommand(test.ctx, [])).rejects.toMatchObject({ status: 400, body: { code: 'organization_scope_required' } })
    expect(test.invalidateUserCache).not.toHaveBeenCalled()
  })
})
