import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { parseWithCustomFields } from '@open-mercato/shared/lib/commands/helpers'
import { extractAllCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { TransportJob } from '../../data/entities'
import { jobCreateSchema, jobUpdateSchema, jobListSchema } from '../../data/validators'
import { commandResultSchema } from '../../data/commandValidators'
import { authorizeLogisticsCommand } from '../../commands/context'
import { readCommandReceipt } from '../../commands/transaction'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { logisticsJson, logisticsRouteError, resolveLogisticsRequest } from '../../lib/api'
import { digestCommandInput } from '../../lib/commandInput'
import { withReceiptRequest } from '../../lib/receiptRequest'
import { jobTimestampValue } from '../../lib/jobTimestamp'

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
        values[property] = jobTimestampValue(property, value)
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
    const invoke = () => crud[method](req)
    let response: Response
    if (method === 'GET') response = await invoke()
    else {
      const { parsed, custom } = parseWithCustomFields(method === 'POST' ? jobCreateSchema : jobUpdateSchema, await readJsonSafe(req.clone(), null))
      const input = { ...parsed, customFields: custom }
      const action = method === 'POST' ? 'logistics.jobs.create' : 'logistics.jobs.update'
      const receipt = () => readCommandReceipt({ ctx, action, requestId: input.requestId, inputDigest: digestCommandInput(input), requiredFeatures: ['logistics.jobs.manage'] })
      const committed = await receipt()
      if (committed) return logisticsJson(responseResult({ result: committed }), method === 'POST' ? 201 : 200)
      response = await withReceiptRequest(req, action, input, invoke)
      if (response.status === 409) {
        const concurrent = await receipt()
        if (concurrent) return logisticsJson(responseResult({ result: concurrent }), method === 'POST' ? 201 : 200)
      }
    }
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
