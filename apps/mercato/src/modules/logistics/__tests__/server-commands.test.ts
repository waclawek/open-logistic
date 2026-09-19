import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { dispatcherCommands } from '../commands/dispatcher'
import { LogisticsOffer, LogisticsTransport } from '../data/entities'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { guardAllocatedOffer } from '../lib/server-offer-guards'

jest.mock('@mikro-orm/core', () => ({ LockMode: { PESSIMISTIC_WRITE: 'write' } }))
jest.mock('../data/entities', () => ({ LogisticsOffer: class LogisticsOffer {}, LogisticsTransport: class LogisticsTransport {} }))
jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand: jest.fn() }))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({ emitCrudSideEffects: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({ enforceCommandOptimisticLockWithGuards: jest.fn(), enforceRecordGoneIsConflict: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('../lib/server-offer-guards', () => ({ guardAllocatedOffer: jest.fn() }))

const tenantId = '00000000-0000-4000-8000-000000000010'
const organizationId = '00000000-0000-4000-8000-000000000011'
const offerId = '00000000-0000-4000-8000-000000000012'
const transportId = '00000000-0000-4000-8000-000000000013'

function fixture() {
  const common = { tenantId, organizationId, customer: 'Customer', reference: 'REFERENCE', origin: 'Warsaw', destination: 'Berlin', pickupDate: '2026-09-21', deliveryDate: '2026-09-22', updatedAt: new Date('2026-09-19T00:00:00.000Z'), createdAt: new Date(), deletedAt: null }
  const transport = Object.assign(new LogisticsTransport(), common, {
    id: transportId, order1: { id: 'O1', status: 'confirmed', cargo: { weightKg: 10, palletSpaces: 1 } },
    order2: { id: 'O2', status: 'confirmed', carrier: 'Carrier', vehicle: { registration: 'REG', typeKey: 'vehicle', capacity: { weightKg: 100, palletSpaces: 10 } } }, additionalLoads: [],
  })
  const offer = Object.assign(new LogisticsOffer(), common, { id: offerId, cargo: { weightKg: 20, palletSpaces: 2 }, priceEur: 100, source: 'email', status: 'new', allocatedTransportId: null })
  let committed = false
  const flush = jest.fn()
  const transaction = { flush }
  const em = { transactional: jest.fn(async (callback: (transaction: object) => Promise<unknown>) => { const result = await callback(transaction); committed = true; return result }) }
  const container = { resolve: (key: string) => key === 'em' ? { fork: () => em } : {} }
  const ctx = { container, auth: { sub: 'user', tenantId, orgId: organizationId }, selectedOrganizationId: organizationId, organizationIds: [organizationId], organizationScope: null, request: new Request('http://localhost/api/logistics/transports/decision') } as unknown as CommandRuntimeContext
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity) => entity === LogisticsTransport ? transport : offer)
  jest.mocked(findWithDecryption).mockResolvedValue([offer])
  jest.mocked(guardAllocatedOffer).mockResolvedValue(async () => { expect(committed).toBe(true) })
  return { transport, offer, ctx, transaction, flush, em }
}

beforeEach(() => jest.resetAllMocks())

it('locks scoped transport before offer and commits allocation before callbacks and side effects', async () => {
  const records = fixture()
  const command = dispatcherCommands.find((entry) => entry.id === 'logistics.transports.decide')!
  const result = await command.execute({ id: transportId, action: 'accept_load', offerId }, records.ctx)
  expect(findOneWithDecryption).toHaveBeenNthCalledWith(1, records.transaction, LogisticsTransport, { tenantId, organizationId, deletedAt: null, id: transportId }, { lockMode: 'write', refresh: true }, { tenantId, organizationId, deletedAt: null })
  expect(findOneWithDecryption).toHaveBeenNthCalledWith(2, records.transaction, LogisticsOffer, { tenantId, organizationId, deletedAt: null, id: offerId }, { lockMode: 'write', refresh: true }, { tenantId, organizationId, deletedAt: null })
  expect(guardAllocatedOffer).toHaveBeenCalledWith(records.ctx, records.offer, { status: 'accepted', allocatedTransportId: transportId })
  expect(records.flush).toHaveBeenCalledTimes(1)
  expect(records.em.transactional).toHaveBeenCalledTimes(1)
  expect(result.item).toMatchObject({ additionalLoads: [{ offerId, orderNumber: 3 }] })
  expect(emitCrudSideEffects).toHaveBeenCalledTimes(2)
})

it('stale parent version aborts before reading or changing the offer', async () => {
  const records = fixture()
  jest.mocked(enforceCommandOptimisticLockWithGuards).mockRejectedValue(new CrudHttpError(409, { code: 'optimistic_lock_conflict' }))
  const command = dispatcherCommands.find((entry) => entry.id === 'logistics.transports.decide')!
  await expect(command.execute({ id: transportId, action: 'accept_load', offerId }, records.ctx)).rejects.toMatchObject({ status: 409 })
  expect(findOneWithDecryption).toHaveBeenCalledTimes(1)
  expect(records.offer.status).toBe('new')
  expect(records.transport.additionalLoads).toEqual([])
  expect(records.flush).not.toHaveBeenCalled()
  expect(emitCrudSideEffects).not.toHaveBeenCalled()
})

it('offer guard rejection leaves both aggregate snapshots unchanged', async () => {
  const records = fixture()
  jest.mocked(guardAllocatedOffer).mockRejectedValue(new CrudHttpError(423, { code: 'offer_locked' }))
  const command = dispatcherCommands.find((entry) => entry.id === 'logistics.transports.decide')!
  await expect(command.execute({ id: transportId, action: 'accept_load', offerId }, records.ctx)).rejects.toMatchObject({ status: 423 })
  expect(records.offer.status).toBe('new')
  expect(records.transport.additionalLoads).toEqual([])
  expect(records.flush).not.toHaveBeenCalled()
})

it('transport deletion guards children before releasing allocations', async () => {
  const records = fixture()
  records.offer.status = 'accepted'
  records.offer.allocatedTransportId = transportId
  const command = dispatcherCommands.find((entry) => entry.id === 'logistics.transports.delete')!
  await command.execute({ id: transportId }, records.ctx)
  expect(findWithDecryption).toHaveBeenCalledWith(records.transaction, LogisticsOffer, { tenantId, organizationId, deletedAt: null, allocatedTransportId: transportId }, { lockMode: 'write', orderBy: { id: 'asc' }, refresh: true }, { tenantId, organizationId, deletedAt: null })
  expect(guardAllocatedOffer).toHaveBeenCalledWith(records.ctx, records.offer, { status: 'review', allocatedTransportId: null })
  expect(records.offer.status).toBe('review')
  expect(records.offer.allocatedTransportId).toBeNull()
  expect(records.transport.deletedAt).toBeInstanceOf(Date)
})
