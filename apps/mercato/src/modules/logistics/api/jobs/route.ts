import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { parseWithCustomFields } from '@open-mercato/shared/lib/commands/helpers'
import { extractAllCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { TransportJob } from '../../data/entities'
import { jobCreateSchema, jobUpdateSchema, jobListSchema } from '../../data/validators'
import { commandResultSchema } from '../../data/commandValidators'
import { authorizeLogisticsCommand } from '../../commands/context'
import { logisticsRouteError, resolveLogisticsRequest } from '../../lib/api'

const entityType = 'logistics:transport_job'
const rawBodySchema = z.record(z.string(), z.unknown())
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['logistics.view'] },
  POST: { requireAuth: true, requireFeatures: ['logistics.view', 'logistics.jobs.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['logistics.view', 'logistics.jobs.manage'] },
}
const fields = {
  id: 'id', reference: 'reference', customerId: 'customer_id', customerNameSnapshot: 'customer_name_snapshot',
  customerReference: 'customer_reference', cargoDescription: 'cargo_description', weightKg: 'weight_kg', isPalletized: 'is_palletized', pallets: 'pallets',
  pickupPlace: 'pickup_place', deliveryPlace: 'delivery_place', pickupWindowStart: 'pickup_window_start', pickupWindowEnd: 'pickup_window_end',
  deliveryWindowStart: 'delivery_window_start', deliveryWindowEnd: 'delivery_window_end', status: 'status', acceptedAt: 'accepted_at',
  firstAssignedAt: 'first_assigned_at', terminalAt: 'terminal_at', notes: 'notes', createdAt: 'created_at', updatedAt: 'updated_at',
}
function responseResult({ result }: { result?: unknown }) {
  const parsed = commandResultSchema.parse(result)
  return { ...parsed, id: parsed.records[0]?.id, updatedAt: parsed.records[0]?.updatedAt }
}
const crud = makeCrudRoute({
  metadata, orm: { entity: TransportJob, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType }, enrichers: { entityId: 'logistics.transport_job' },
  list: {
    schema: jobListSchema, entityId: entityType, fields: Object.values(fields), disableListCache: true,
    sortFieldMap: { createdAt: 'created_at', updatedAt: 'updated_at', reference: 'reference' }, defaultSort: { field: 'createdAt', dir: 'desc' }, tiebreakSortField: 'id',
    async buildFilters(query, ctx) {
      const context = await authorizeLogisticsCommand(ctx, [])
      return { tenant_id: context.scope.tenantId, organization_id: context.scope.organizationId,
        ...(query.id ? { id: query.id } : {}), ...(query.status ? { status: query.status } : {}) }
    },
    decorateCustomFields: { entityIds: [entityType], stripPrefixedKeys: true },
    transformItem(item: Record<string, unknown>) {
      const values: Record<string, unknown> = {}
      for (const [property, column] of Object.entries(fields)) {
        const value = item[column] ?? item[property] ?? null
        values[property] = value instanceof Date ? value.toISOString() : value
      }
      return { ...values, ...extractAllCustomFieldEntries(item) }
    },
  },
  actions: {
    create: { commandId: 'logistics.jobs.create', schema: rawBodySchema, status: 201,
      mapInput: ({ raw }) => { const { parsed, custom } = parseWithCustomFields(jobCreateSchema, raw); return { ...parsed, customFields: custom } }, response: responseResult },
    update: { commandId: 'logistics.jobs.update', schema: rawBodySchema,
      mapInput: ({ raw }) => { const { parsed, custom } = parseWithCustomFields(jobUpdateSchema, raw); return { ...parsed, customFields: custom } }, response: responseResult },
  },
})

async function handle(req: Request, method: 'GET' | 'POST' | 'PUT') {
  try {
    const ctx = await resolveLogisticsRequest(req)
    await authorizeLogisticsCommand(ctx, method === 'GET' ? [] : ['logistics.jobs.manage'])
    const response = await crud[method](req)
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) { return logisticsRouteError(error) }
}
export const GET = (req: Request) => handle(req, 'GET')
export const POST = (req: Request) => handle(req, 'POST')
export const PUT = (req: Request) => handle(req, 'PUT')

export const openApi: OpenApiRouteDoc = { tag: 'Logistics', methods: {
  GET: { summary: 'List scoped transport jobs or retrieve one by ID', query: jobListSchema,
    responses: [{ status: 200, description: 'Paged jobs with current versions and custom fields' }] },
  POST: { summary: 'Create an unaccepted transport job', requestBody: { schema: jobCreateSchema },
    responses: [{ status: 201, description: 'Created draft with receipt and version' }, { status: 400, description: 'Invalid input' }, { status: 403, description: 'Access denied' }] },
  PUT: { summary: 'Edit an unaccepted draft with its current version', requestBody: { schema: jobUpdateSchema },
    responses: [{ status: 200, description: 'Updated draft with receipt and version' }, { status: 409, description: 'Draft state, receipt or version conflict' }] },
} }
