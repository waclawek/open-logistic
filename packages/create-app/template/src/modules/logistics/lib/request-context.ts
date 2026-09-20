import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { getAuthFromRequest, type AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  resolveOrganizationScopeForRequest,
  type OrganizationScope,
} from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { TransportScope } from './transports'

export class LogisticsRequestContextError extends Error {
  constructor(readonly status: number, readonly code: 'unauthorized' | 'forbidden' | 'organization_required') {
    super(code)
    this.name = 'LogisticsRequestContextError'
  }
}

export type LogisticsRequestContext = {
  container: AwilixContainer
  em: EntityManager
  auth: AuthContext
  organizationScope: OrganizationScope
  scope: TransportScope
}

export async function resolveLogisticsRequestContext(request: Request): Promise<LogisticsRequestContext> {
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) throw new LogisticsRequestContextError(401, 'unauthorized')
  const container = await createRequestContainer()
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
  if (organizationScope.selectionRejected) {
    throw new LogisticsRequestContextError(403, 'forbidden')
  }
  const organizationId = organizationScope.selectedId ?? auth.orgId ?? null
  if (!organizationId) throw new LogisticsRequestContextError(400, 'organization_required')
  const tenantId = organizationScope.tenantId ?? auth.tenantId
  const em = container.resolve<EntityManager>('em').fork({
    clear: true,
    freshEventManager: true,
    useContext: true,
  })
  return {
    container,
    em,
    auth: tenantId === auth.tenantId ? auth : { ...auth, tenantId },
    organizationScope,
    scope: { tenantId, organizationId },
  }
}
