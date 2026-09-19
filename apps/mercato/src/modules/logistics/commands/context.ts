import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { OrganizationScopeService } from '@open-mercato/shared/lib/auth/principal-service'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { uuidSchema } from '../data/validators'
import { isAllOrganizationsSelection } from '@open-mercato/core/modules/directory/constants'
import { parseSelectedOrganizationCookie } from '@open-mercato/core/modules/directory/utils/scopeCookies'

export async function authorizeLogisticsCommand(ctx: CommandRuntimeContext, required: string[]) {
  const { translate } = await resolveTranslations()
  const fail = (status: number, code: string): never => { throw new CrudHttpError(status, { error: translate(`logistics.errors.${code}`), code }) }
  if (!ctx.auth) return fail(401, 'unauthorized')
  if (ctx.organizationScope?.selectionRejected) return fail(403, 'forbidden')
  const tenantId = ctx.auth.tenantId
  const organizationId = ctx.selectedOrganizationId
  const requestedOrganization = parseSelectedOrganizationCookie(ctx.request?.headers.get('cookie'))?.trim()
  if (!tenantId || !organizationId || isAllOrganizationsSelection(requestedOrganization)) return fail(400, 'organization_scope_required')
  if (ctx.auth.isApiKey) return fail(403, 'forbidden')
  const actorUserId = ctx.auth.sub
  if (![tenantId, organizationId, actorUserId].every((id) => uuidSchema.safeParse(id).success)) return fail(403, 'forbidden')
  const service = ctx.container.resolve<OrganizationScopeService>('organizationScopeService')
  const fresh = await service.resolveFresh({ auth: { ...ctx.auth, isSuperAdmin: false }, selectedId: organizationId, tenantId })
  if (fresh.scope.selectionRejected || fresh.scope.tenantId !== tenantId || fresh.scope.selectedId !== organizationId) return fail(403, 'forbidden')
  const permissions = { grantedFeatures: fresh.acl.features, unrestricted: fresh.acl.isSuperAdmin,
    scopeAllowed: fresh.acl.isSuperAdmin || fresh.scope.allowedIds === null || fresh.scope.allowedIds.includes(organizationId) }
  if (!authorizeFeatures(['logistics.view', ...required], permissions)) return fail(403, 'forbidden')
  return { scope: { tenantId, organizationId }, actorUserId, permissions, translate, fail }
}

export type LogisticsCommandContext = Awaited<ReturnType<typeof authorizeLogisticsCommand>>
