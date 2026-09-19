import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { buildQueryParams } from '@open-mercato/shared/lib/crud/query-params'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import { transportCreateSchema, transportDetailSchema, deleteSchema, salesTransportListQuerySchema } from '../../data/validators'
import { resolveLogisticsRequestContext } from '../../lib/request-context'
import { loadTransportList, registerTransportOptimisticLockReader, TooManyTransportsError } from '../../lib/transports'
import { logisticsError } from '../../lib/server-domain'
import { logisticsResponse } from '../response'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['logistics.view'] },
  POST: { requireAuth: true, requireFeatures: ['logistics.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['logistics.manage'] },
}
registerTransportOptimisticLockReader()
const mutationRoutes = makeCrudRoute({
  metadata,
  orm: { entity: SalesOrder, tenantField: 'tenantId', orgField: 'organizationId' },
  indexer: { entityType: 'sales:sales_order' },
  actions: {
    create: { commandId: 'logistics.transports.create', schema: transportCreateSchema, mapInput: ({ parsed }) => parsed, response: ({ result }) => ({ item: { ...result.item, id: result.item.order1.id, updatedAt: result.item.updatedAt } }), status: 201 },
    delete: { commandId: 'logistics.transports.delete', mapInput: ({ raw }) => deleteSchema.parse({ ...raw.query, ...raw.body }), response: () => ({ ok: true }) },
  },
})
export const POST = mutationRoutes.POST
export const DELETE = mutationRoutes.DELETE
export async function GET(request: Request) {
  return logisticsResponse(async () => {
    const { em, scope } = await resolveLogisticsRequestContext(request)
    try { return Response.json(await loadTransportList(em, scope, salesTransportListQuerySchema.parse(buildQueryParams(new URL(request.url).searchParams)))) }
    catch (error) { if (error instanceof TooManyTransportsError) return logisticsError(422, 'tooManyTransports'); throw error }
  })
}
export const openApi = {
  tag: 'Logistics', methods: {
    GET: { summary: 'List Sales-backed transports', query: salesTransportListQuerySchema, responses: [{ status: 200, schema: z.object({ items: z.array(z.record(z.string(), z.unknown())), total: z.number(), totalPages: z.number(), page: z.number(), pageSize: z.number() }) }] },
    POST: { summary: 'Create a Sales-backed transport from dispatcher input', requestBody: { schema: transportCreateSchema }, responses: [{ status: 201, schema: z.object({ item: transportDetailSchema.extend({ id: z.uuid(), updatedAt: z.iso.datetime() }) }) }] },
    DELETE: { summary: 'Delete a transport and its Sales child orders', query: deleteSchema, headers: z.object({ 'x-om-ext-optimistic-lock-expected-updated-at': z.iso.datetime().optional() }), responses: [{ status: 200, schema: z.object({ ok: z.boolean() }) }] },
  },
}
