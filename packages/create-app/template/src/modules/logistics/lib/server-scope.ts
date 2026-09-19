import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { logisticsError } from './server-domain'

export function commandScope(ctx: CommandRuntimeContext) {
  const tenantId = ctx.auth?.tenantId ?? (ctx.systemActor ? ctx.organizationScope?.tenantId : undefined)
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId
  if (!tenantId || !organizationId) return logisticsError(400, 'scopeRequired')
  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)
  return { tenantId, organizationId, deletedAt: null }
}
