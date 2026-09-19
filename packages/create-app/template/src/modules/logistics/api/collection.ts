import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createCrudOpenApiFactory, createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import type { Where } from '@open-mercato/shared/lib/query/types'
import { LogisticsOffer, LogisticsTransport } from '../data/entities'
import { listQuerySchema, offerCreateSchema, transportCreateSchema, offerItemSchema, transportItemSchema, deleteSchema } from '../data/validators'

const commonFields = ['id', 'reference', 'customer', 'origin', 'destination', 'pickup_date', 'delivery_date', 'updated_at', 'tenant_id', 'organization_id']
const buildOpenApi = createCrudOpenApiFactory({ defaultTag: 'Logistics' })

export function dispatcherCollection(kind: 'offer' | 'transport') {
  const isOffer = kind === 'offer'
  const itemSchema = isOffer ? offerItemSchema : transportItemSchema
  const createSchema = isOffer ? offerCreateSchema : transportCreateSchema
  const entityType = `logistics:logistics_${kind}`
  const routes = makeCrudRoute({
    metadata: {
      GET: { requireAuth: true, requireFeatures: ['logistics.view'] },
      POST: { requireAuth: true, requireFeatures: ['logistics.manage'] },
      DELETE: { requireAuth: true, requireFeatures: ['logistics.manage'] },
    },
    orm: { entity: isOffer ? LogisticsOffer : LogisticsTransport, tenantField: 'tenantId', orgField: 'organizationId', softDeleteField: 'deletedAt' },
    indexer: { entityType },
    list: {
      schema: listQuerySchema, entityId: entityType,
      fields: [...commonFields, ...(isOffer ? ['cargo', 'price_eur', 'source', 'status'] : ['order_1', 'order_2', 'additional_loads'])],
      defaultSort: { field: 'reference', dir: 'asc' }, tiebreakSortField: 'id',
      disableListCache: true,
      buildFilters(query) {
        const filters: Where<Record<string, unknown>> = {}
        if (query.id) filters.id = query.id
        if (isOffer && query.available) filters.status = { $in: ['new', 'review'] }
        if (query.search) {
          const pattern = `%${escapeLikePattern(query.search)}%`
          filters.$or = ['reference', 'customer', 'origin', 'destination'].map((field) => ({ [field]: { $ilike: pattern } }))
        }
        return filters
      },
      transformItem(item: Record<string, unknown>) {
        const version = item.updated_at ?? item.updatedAt
        return itemSchema.parse({
          ...item, pickupDate: item.pickup_date ?? item.pickupDate, deliveryDate: item.delivery_date ?? item.deliveryDate,
          updatedAt: version instanceof Date ? version.toISOString() : typeof version === 'string' ? new Date(version).toISOString() : version,
          ...(isOffer ? { priceEur: Number(item.price_eur ?? item.priceEur) }
            : { order1: item.order_1 ?? item.order1, order2: item.order_2 ?? item.order2 ?? null, additionalLoads: item.additional_loads ?? item.additionalLoads ?? [] }),
        })
      },
    },
    actions: {
      create: { commandId: `logistics.${kind}s.create`, schema: createSchema, mapInput: ({ parsed }) => parsed, response: ({ result }) => ({ item: result.item }), status: 201 },
      delete: { commandId: `logistics.${kind}s.delete`, mapInput: ({ raw }) => deleteSchema.parse({ ...raw.query, ...raw.body }), response: () => ({ ok: true }) },
    },
  })
  const openApi = buildOpenApi({
    resourceName: isOffer ? 'Offer' : 'Transport', querySchema: listQuerySchema,
    listResponseSchema: createPagedListResponseSchema(itemSchema),
    create: { schema: createSchema, responseSchema: z.object({ item: itemSchema }) },
    del: { schema: deleteSchema, description: 'Soft-delete a scoped record. Send x-om-ext-optimistic-lock-expected-updated-at with its current updatedAt.' },
  })
  return { ...routes, openApi }
}
