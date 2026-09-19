import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getAllMutationGuardInstances } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { bridgeLegacyGuard, runMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { offerDecisionSchema, transportDecisionSchema, offerItemSchema, transportItemSchema } from '../data/validators'
import { logisticsError } from '../lib/server-domain'

const logger = createLogger('logistics').child({ component: 'decisions' })
const paramsSchema = z.object({ id: z.uuid() })
export const decisionMetadata = { POST: { requireAuth: true, requireFeatures: ['logistics.manage'] } }

type DecisionContext = { params?: { id?: string } | Promise<{ id?: string }> }

export function decisionRoute(kind: 'offer' | 'transport') {
  const schema = kind === 'offer' ? offerDecisionSchema : transportDecisionSchema
  const itemSchema = kind === 'offer' ? offerItemSchema : transportItemSchema
  async function POST(request: Request, routeContext: DecisionContext) {
    try {
      const initialAuth = await getAuthFromRequest(request)
      if (!initialAuth?.tenantId) return await logisticsError(401, 'unauthorized')
      const container = await createRequestContainer()
      const organizationScope = await resolveOrganizationScopeForRequest({ container, auth: initialAuth, request })
      if (organizationScope?.selectionRejected) return await logisticsError(422, 'scopeRequired')
      const auth = { ...initialAuth, tenantId: organizationScope?.tenantId ?? initialAuth.tenantId }
      const organizationId = organizationScope?.selectedId ?? auth.orgId
      if (!organizationId) return await logisticsError(400, 'scopeRequired')
      const { id } = paramsSchema.parse(await routeContext.params)
      const parsed = schema.parse(await readJsonSafe(request, {}))
      const guardInput = {
        tenantId: auth.tenantId, organizationId, userId: auth.sub, resourceKind: `logistics.${kind}`, resourceId: id,
        operation: 'update' as const, requestMethod: request.method, requestHeaders: request.headers, mutationPayload: { ...parsed, id },
      }
      const rbac = container.resolve<{ getGrantedFeatures(userId: string, scope: { tenantId: string; organizationId: string }): Promise<string[]> }>('rbacService')
      const userFeatures = await rbac.getGrantedFeatures(auth.sub, { tenantId: auth.tenantId, organizationId })
      const legacy = bridgeLegacyGuard(container)
      const guardResult = await runMutationGuards([...getAllMutationGuardInstances(), ...(legacy ? [legacy] : [])], guardInput, { userFeatures })
      if (!guardResult.ok) return Response.json(guardResult.errorBody, { status: guardResult.errorStatus ?? 422 })
      const guardedInput = schema.parse({ ...parsed, ...guardResult.modifiedPayload })
      const ctx: CommandRuntimeContext = { container, auth, organizationScope, selectedOrganizationId: organizationId, organizationIds: organizationScope?.filterIds ?? [organizationId], request }
      const bus = container.resolve<CommandBus>('commandBus')
      const { result } = await bus.execute<unknown, { item: unknown }>(`logistics.${kind}s.decide`, { input: { ...guardedInput, id }, ctx })
      for (const callback of guardResult.afterSuccessCallbacks) {
        try {
          await callback.guard.afterSuccess?.({ ...guardInput, metadata: callback.metadata })
        } catch (error) {
          logger.warn('Mutation guard afterSuccess callback failed', { error })
          getTelemetryRuntime()?.reportError(error, { module: 'logistics', code: 'logistics.guard_callback_failed' })
        }
      }
      return Response.json({ item: result.item })
    } catch (error) {
      const interceptorRejection = getCommandInterceptorHttpRejection(error)
      if (interceptorRejection) return Response.json(interceptorRejection.body, { status: interceptorRejection.status })
      if (isCrudHttpError(error)) return Response.json(error.body, { status: error.status })
      if (error instanceof z.ZodError) {
        try { await logisticsError(400, 'invalidInput') } catch (validationError) {
          if (validationError instanceof CrudHttpError) return Response.json(validationError.body, { status: 400 })
        }
      }
      throw error
    }
  }
  const openApi: OpenApiRouteDoc = {
    tag: 'Logistics', pathParams: paramsSchema,
    methods: { POST: { summary: `Apply ${kind} decision`, requestBody: { schema },
      headers: z.object({ 'x-om-ext-optimistic-lock-expected-updated-at': z.iso.datetime().optional() }),
      responses: [{ status: 200, schema: z.object({ item: itemSchema }) }],
      errors: [{ status: 400 }, { status: 401 }, { status: 403 }, { status: 404 }, { status: 409 }],
    } },
  }
  return { POST, openApi, metadata: decisionMetadata }
}
