import type { EntityManager } from '@mikro-orm/postgresql'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import {
  loadTransportList,
  MAX_TRANSPORTS_PER_ORGANIZATION,
  TooManyTransportsError,
} from '../lib/transports'
import { transportFieldsFromMetadata } from '../lib/transport-metadata'

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({ loadCustomFieldValues: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn() }))
jest.mock('@open-mercato/core/modules/sales/data/entities', () => ({ SalesOrder: class {} }))
jest.mock('@open-mercato/core/modules/customers/data/entities', () => ({ CustomerEntity: class {} }))
jest.mock('@open-mercato/core/modules/entities/data/entities', () => ({ CustomFieldValue: class {} }))

const scope = { tenantId: 'tenant-1', organizationId: 'organization-1' }
const query = {
  page: 1,
  pageSize: 20,
  sortField: 'updatedAt' as const,
  sortDir: 'desc' as const,
}

function salesOrder(id: string, logistics?: Record<string, unknown>): SalesOrder {
  return {
    id,
    orderNumber: `SO-${id}`,
    currencyCode: 'EUR',
    status: 'confirmed',
    customerEntityId: null,
    customerSnapshot: null,
    updatedAt: new Date('2026-09-19T10:00:00.000Z'),
    metadata: logistics ? { logistics } : null,
  } as SalesOrder
}

function customFieldRow(recordId: string, role: string) {
  return {
    recordId,
    valueText: role,
    valueMultiline: null,
    valueInt: null,
    valueFloat: null,
    valueBool: null,
  }
}

function entityManager(roleRows: ReturnType<typeof customFieldRow>[] = []): EntityManager {
  return {
    find: jest.fn().mockResolvedValue(roleRows),
  } as unknown as EntityManager
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(loadCustomFieldValues).mockResolvedValue({})
})

test('v1 client transport metadata is the primary transport marker and field source', async () => {
  const order = salesOrder('metadata-client', {
    version: 1,
    kind: 'client_transport',
    transportRole: 'client',
    pickupAddress: 'Metadata pickup',
    cargoWeightKg: 1250,
  })
  const unrelatedOrder = salesOrder('unrelated-metadata', {
    version: 1,
    kind: 'other',
    transportRole: 'client',
  })
  jest.mocked(findWithDecryption).mockResolvedValueOnce([order, unrelatedOrder])
  jest.mocked(loadCustomFieldValues).mockImplementation(async ({ entityId }) => entityId === 'sales:sales_order'
    ? { [order.id]: { cf_pickup_address: 'Legacy pickup', cf_client_price: 400 } }
    : {})

  const result = await loadTransportList(entityManager(), scope, query)

  expect(result.items).toHaveLength(1)
  expect(result.items[0]).toMatchObject({
    id: order.id,
    pickupAddress: 'Metadata pickup',
    cargoWeightKg: 1250,
    clientPrice: 400,
  })
  expect(jest.mocked(findWithDecryption).mock.calls[0]?.[2]).toMatchObject({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
    metadata: { $ne: null },
  })
})

test('legacy custom-field transports remain visible beside metadata transports', async () => {
  const metadataOrder = salesOrder('metadata-client', {
    version: 1,
    kind: 'client_transport',
    transportRole: 'client',
  })
  const legacyOrder = salesOrder('legacy-client')
  jest.mocked(findWithDecryption)
    .mockResolvedValueOnce([metadataOrder])
    .mockResolvedValueOnce([legacyOrder])

  const result = await loadTransportList(
    entityManager([customFieldRow(legacyOrder.id, 'client')]),
    scope,
    query,
  )

  expect(result.items.map((item) => item.id).sort()).toEqual([legacyOrder.id, metadataOrder.id].sort())
})

test('unversioned or differently namespaced metadata is ignored', () => {
  expect(transportFieldsFromMetadata({ logistics: { kind: 'client_transport', transportRole: 'client' } })).toEqual({})
  expect(transportFieldsFromMetadata({ logistics: { version: 1, kind: 'other', transportRole: 'client' } })).toEqual({})
  expect(transportFieldsFromMetadata({ logistics: { version: 2, kind: 'client_transport', transportRole: 'client' } })).toEqual({})
})

test('canonical exchange reference metadata retains the legacy alias fallback', () => {
  const envelope = { version: 1, kind: 'client_transport', transportRole: 'client' }

  expect(transportFieldsFromMetadata({ logistics: { ...envelope, exchangeReference: 'RFQ-42' } })).toMatchObject({
    exchange_ref: 'RFQ-42',
  })
  expect(transportFieldsFromMetadata({ logistics: { ...envelope, exchangeRef: 'legacy-42' } })).toMatchObject({
    exchange_ref: 'legacy-42',
  })
})

test('metadata transports preserve the organization safety limit', async () => {
  const orders = Array.from({ length: MAX_TRANSPORTS_PER_ORGANIZATION + 1 }, (_, index) => salesOrder(`metadata-${index}`, {
    version: 1,
    kind: 'client_transport',
    transportRole: 'client',
  }))
  jest.mocked(findWithDecryption).mockResolvedValueOnce(orders)

  await expect(loadTransportList(entityManager(), scope, query)).rejects.toEqual(
    new TooManyTransportsError(MAX_TRANSPORTS_PER_ORGANIZATION + 1),
  )
})
