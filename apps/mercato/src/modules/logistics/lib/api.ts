import { ZodError } from 'zod'
import { resolveRequestContext } from '@open-mercato/shared/lib/api/context'
import type { OrganizationScopeService } from '@open-mercato/shared/lib/auth/principal-service'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { reportError } from '@open-mercato/telemetry'

export async function resolveLogisticsRequest(req: Request): Promise<CommandRuntimeContext> {
  const { ctx } = await resolveRequestContext(req)
  const service = ctx.container.resolve<OrganizationScopeService>('organizationScopeService')
  const organizationScope = await service.resolveForRequest({ auth: ctx.auth, request: req })
  return { container: ctx.container, auth: ctx.auth, organizationScope,
    selectedOrganizationId: organizationScope.selectedId, organizationIds: organizationScope.filterIds, request: req }
}

export function logisticsJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function logisticsRouteError(error: unknown): Promise<Response> {
  if (isCrudHttpError(error)) return logisticsJson(error.body, error.status)
  const rejection = getCommandInterceptorHttpRejection(error)
  if (rejection) return logisticsJson(rejection.body, rejection.status)
  const { translate } = await resolveTranslations()
  if (error instanceof ZodError) return logisticsJson({ error: translate('logistics.errors.invalidInput'), code: 'invalid_input' }, 400)
  reportError(new Error('[internal] Logistics request failed'), { module: 'logistics', code: 'logistics.request_failed' })
  return logisticsJson({ error: translate('logistics.errors.requestFailed'), code: 'request_failed' }, 500)
}
