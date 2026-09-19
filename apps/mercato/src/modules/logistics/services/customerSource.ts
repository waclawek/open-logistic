import { z } from 'zod'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import type { LogisticsCommandContext } from '../commands/context'
import { uuidSchema } from '../data/validators'

const customerProjectionSchema = z.object({
  id: uuidSchema,
  tenant_id: uuidSchema,
  organization_id: uuidSchema,
  kind: z.enum(['person', 'company']),
  display_name: z.string().trim().min(1).max(200),
  deleted_at: z.null(),
})

export async function readCustomerSource(queryEngine: Pick<QueryEngine, 'query'> | null, context: LogisticsCommandContext, customerId: string) {
  uuidSchema.parse(customerId)
  const canReadPeople = authorizeFeatures(['customers.people.view'], context.permissions)
  const canReadCompanies = authorizeFeatures(['customers.companies.view'], context.permissions)
  if (!canReadPeople && !canReadCompanies) return context.fail(403, 'forbidden')
  const entityId = getEntityIds(false).customers?.customer_entity
  if (!queryEngine || !entityId) return context.fail(503, 'sourceUnavailable')
  const filters = {
    id: customerId, tenant_id: context.scope.tenantId, organization_id: context.scope.organizationId,
    ...(canReadPeople && canReadCompanies ? {} : { kind: canReadPeople ? 'person' : 'company' }),
  }
  const result = await queryEngine.query<Record<string, unknown>>(entityId, {
    ...context.scope, fields: ['id', 'tenant_id', 'organization_id', 'kind', 'display_name', 'deleted_at'],
    filters, page: { page: 1, pageSize: 1 }, includeCustomFields: false, includeExtensions: false,
    withDeleted: false, skipAutoReindex: true,
  })
  if (result.meta?.partialIndexWarning || result.meta?.listCountCapWarning || result.meta?.encryptedSortRowCapWarning
    || result.page !== 1 || result.pageSize !== 1 || result.total > 1) return context.fail(503, 'sourceUnavailable')
  if (result.total !== 1 || result.items.length !== 1) return context.fail(404, 'notFound')
  const parsed = customerProjectionSchema.safeParse(result.items[0])
  if (!parsed.success || parsed.data.id !== customerId || parsed.data.tenant_id !== context.scope.tenantId
    || parsed.data.organization_id !== context.scope.organizationId) return context.fail(404, 'notFound')
  if (!authorizeFeatures([parsed.data.kind === 'person' ? 'customers.people.view' : 'customers.companies.view'], context.permissions)) return context.fail(403, 'forbidden')
  return { id: parsed.data.id, name: parsed.data.display_name }
}
