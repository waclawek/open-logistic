import { salesTransportCommands, assertLoadFits, nextLoadNumber } from '../commands/sales-transports'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { executeSales, withSalesTransaction } from '../lib/sales-transaction'
import { createOrder } from '../lib/sales-orders'
import { commandScope } from '../lib/server-scope'
import { loadTransportDetail, lockLinkedSalesOrders } from '../lib/transports'
import type { TransportDetail } from '../types'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

jest.mock('@mikro-orm/core', () => ({ LockMode: { PESSIMISTIC_WRITE: 'write' } }))
jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand: jest.fn() }))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({ emitCrudSideEffects: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({ enforceCommandOptimisticLockWithGuards: jest.fn(), enforceRecordGoneIsConflict: jest.fn() }))
jest.mock('@open-mercato/core/modules/sales/data/entities', () => ({ SalesOrder: class {}, SalesChannel: class {} }))
jest.mock('@open-mercato/core/modules/customers/data/entities', () => ({ CustomerEntity: class {} }))
jest.mock('@open-mercato/core/modules/sales/lib/statusHelpers', () => ({ resolveStatusEntryIdByValue: jest.fn(async () => 'status') }))
jest.mock('../data/entities', () => ({ LogisticsOffer: class {} }))
jest.mock('../lib/server-scope', () => ({ commandScope: jest.fn(async () => ({ tenantId: 'tenant', organizationId: 'org', deletedAt: null })) }))
jest.mock('../lib/transports', () => ({ loadTransportDetail: jest.fn(), lockLinkedSalesOrders: jest.fn(async () => undefined) }))
jest.mock('../lib/sales-transaction', () => ({ withSalesTransaction: jest.fn(), executeSales: jest.fn() }))
jest.mock('../lib/sales-orders', () => ({
  channelId: jest.fn(async () => 'channel'),
  createLegacyTransport: jest.fn(),
  createOrder: jest.fn(async () => 'carrier-order'),
  requiredStatus: jest.fn(async () => 'status'),
}))
jest.mock('../lib/server-offer-guards', () => ({ guardAllocatedOffer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))

const id = '00000000-0000-4000-8000-000000000001'
const carrierId = '00000000-0000-4000-8000-000000000002'
const updatedAt = '2026-09-19T00:00:00.000Z'
function detail(): TransportDetail {
  const base = { orderNumber: 'TEST', currencyCode: 'EUR', customerId: null, customerName: 'Test', updatedAt }
  return { transportVersion: 'a'.repeat(64), updatedAt, order1: { ...base, id, status: 'confirmed', fields: { transport_role: 'client', cargo_pallets: 2, cargo_weight_kg: 500 } }, order2: { ...base, id: carrierId, status: 'approved', fields: { transport_role: 'carrier', vehicle_capacity_pallets: 6, vehicle_capacity_kg: 1500 } }, carrierHistory: [], additionalLoads: [], freeSpace: { pallets: 4, kg: 1000, limiting: 'pallets' } }
}
beforeEach(() => {
  jest.resetAllMocks()
  jest.mocked(commandScope).mockResolvedValue({ tenantId: 'tenant', organizationId: 'org', deletedAt: null })
})
test('capacity checks require confirmed primary order and approved carrier, independently enforce both dimensions', async () => {
  await expect(assertLoadFits(detail(), 4, 1000)).resolves.toBeUndefined()
  await expect(assertLoadFits(detail(), 5, 1)).rejects.toMatchObject({ status: 409 })
  await expect(assertLoadFits(detail(), 1, 1001)).rejects.toMatchObject({ status: 409 })
  const pending = detail(); pending.order2!.status = 'pending_approval'
  await expect(assertLoadFits(pending, 1, 1)).rejects.toMatchObject({ status: 409 })
})
test('sequential numbering never reuses rejected load numbers', () => {
  const transport = detail()
  transport.additionalLoads = [{ ...transport.order1, status: 'rejected', fields: { transport_order_number: 5 } }]
  expect(nextLoadNumber(transport)).toBe(6)
})
test('stale parent version stops before reading child orders or mutating Sales', async () => {
  jest.mocked(findOneWithDecryption).mockResolvedValue({ id, updatedAt: new Date(updatedAt) } as never)
  jest.mocked(enforceCommandOptimisticLockWithGuards).mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }))
  const ctx = { container: {}, request: new Request('http://localhost') } as CommandRuntimeContext
  jest.mocked(loadTransportDetail).mockResolvedValue({ ...detail(), order2: null })
  jest.mocked(withSalesTransaction).mockImplementation(async (_ctx, run) => run({ em: {} as never, ctx, afterCommit: [] }))
  await expect(salesTransportCommands.find((entry) => entry.id === 'logistics.transports.decide')!.execute({ id, action: 'approve_carrier' }, ctx)).rejects.toMatchObject({ status: 409 })
  expect(loadTransportDetail).toHaveBeenCalled()
  expect(executeSales).not.toHaveBeenCalled()
})

test('deleting a transport includes linked cancelled carrier orders hidden from the displayed detail', async () => {
  const hiddenId = '00000000-0000-4000-8000-000000000003'
  const ctx = { container: {}, request: new Request('http://localhost') } as CommandRuntimeContext
  const em = { flush: jest.fn() }
  jest.mocked(withSalesTransaction).mockImplementation(async (_ctx, run) => run({ em: em as never, ctx, afterCommit: [] }))
  jest.mocked(loadTransportDetail).mockResolvedValue({ ...detail(), order2: null })
  jest.mocked(lockLinkedSalesOrders).mockResolvedValue([{ id: hiddenId, status: 'canceled', updatedAt: new Date(updatedAt) }] as never)
  jest.mocked(findWithDecryption).mockResolvedValue([])
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, _entity, filter) => ({ id: (filter as { id: string }).id, updatedAt: new Date(updatedAt) }) as never)
  jest.mocked(enforceCommandOptimisticLockWithGuards).mockResolvedValue(undefined)
  await salesTransportCommands.find((entry) => entry.id === 'logistics.transports.delete')!.execute({ id }, ctx)
  expect(jest.mocked(executeSales).mock.calls.map((call) => [call[1], call[2].id])).toEqual([['delete', hiddenId], ['delete', id]])
})

test('agent carrier approval creates an approved Order 2 through the Sales command layer', async () => {
  const ctx = { container: {}, request: new Request('http://localhost') } as CommandRuntimeContext
  const em = { clear: jest.fn() }
  const withoutCarrier = { ...detail(), order2: null }
  jest.mocked(withSalesTransaction).mockImplementation(async (_ctx, run) => run({ em: em as never, ctx, afterCommit: [] }))
  jest.mocked(findOneWithDecryption).mockResolvedValue({ id, updatedAt: new Date(updatedAt), currencyCode: 'EUR', channelId: null } as never)
  jest.mocked(enforceCommandOptimisticLockWithGuards).mockResolvedValue(undefined)
  jest.mocked(loadTransportDetail)
    .mockResolvedValueOnce(withoutCarrier)
    .mockResolvedValueOnce(detail())

  await salesTransportCommands
    .find((entry) => entry.id === 'logistics.transports.approve_agent_carrier')!
    .execute({
      id,
      carrierName: 'Trans-Łódź Sp. z o.o.',
      carrierCost: 920,
      vehicleType: 'SEMI_TRAILER',
      vehicleCapacityPallets: 33,
      vehicleCapacityKg: 24_000,
      currencyCode: 'EUR',
      exchangeSource: 'trans',
      exchangeRef: 'veh-lodz-1',
      note: 'Approved by the Agent Inbox operator.',
    }, ctx)

  expect(createOrder).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
    customerName: 'Trans-Łódź Sp. z o.o.',
    status: 'approved',
    fields: expect.objectContaining({
      transport_role: 'carrier',
      transport_parent_id: id,
      transport_order_number: 2,
      exchange_ref: 'veh-lodz-1',
    }),
  }))
})
