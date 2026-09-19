import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { dispatcherCommands } from '../commands/dispatcher'
import { LogisticsOffer } from '../data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'

jest.mock('@mikro-orm/core', () => ({ LockMode: { PESSIMISTIC_WRITE: 'write' } }))
jest.mock('../data/entities', () => ({ LogisticsOffer: class LogisticsOffer {}, LogisticsTransport: class LogisticsTransport {} }))
jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand: jest.fn() }))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({ emitCrudSideEffects: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({ enforceCommandOptimisticLockWithGuards: jest.fn(), enforceRecordGoneIsConflict: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('../lib/server-offer-guards', () => ({ guardAllocatedOffer: jest.fn() }))

const scope = { tenantId: '00000000-0000-4000-8000-000000000010', organizationId: '00000000-0000-4000-8000-000000000011' }
function fixture(allocated = false) {
  const offer = Object.assign(new LogisticsOffer(), scope, { id: '00000000-0000-4000-8000-000000000012', customer: 'Customer', reference: 'OF-TEST', origin: 'Warsaw', destination: 'Berlin', pickupDate: '2026-09-21', deliveryDate: '2026-09-22', updatedAt: new Date('2026-09-19T00:00:00.000Z'), createdAt: new Date(), deletedAt: null, cargo: { weightKg: 20, palletSpaces: 2 }, priceEur: 100, source: 'email', status: allocated ? 'accepted' : 'new', allocatedTransportId: allocated ? 'transport' : null })
  const flush = jest.fn()
  const transaction = { flush }
  const em = { transactional: async (run: (value: object) => Promise<unknown>) => run(transaction) }
  const ctx = { container: { resolve: (key: string) => key === 'em' ? { fork: () => em } : {} }, auth: { sub: 'user', tenantId: scope.tenantId, orgId: scope.organizationId }, selectedOrganizationId: scope.organizationId, organizationScope: null } as unknown as CommandRuntimeContext
  jest.mocked(findOneWithDecryption).mockResolvedValue(offer)
  return { offer, ctx, flush, transaction }
}
beforeEach(() => jest.clearAllMocks())
it('rejects an available scoped persisted offer and emits its update', async () => {
  const test = fixture()
  const result = await dispatcherCommands.find((entry) => entry.id === 'logistics.offers.decide')!.execute({ id: test.offer.id, action: 'reject' }, test.ctx)
  expect(findOneWithDecryption).toHaveBeenCalledWith(test.transaction, LogisticsOffer, { ...scope, id: test.offer.id, deletedAt: null }, { lockMode: 'write', refresh: true }, { ...scope, deletedAt: null })
  expect(result.item).toMatchObject({ status: 'rejected' })
  expect(test.flush).toHaveBeenCalled()
  expect(emitCrudSideEffects).toHaveBeenCalled()
})
it('cannot reject or delete an offer already assigned to a Sales transport', async () => {
  const test = fixture(true)
  for (const action of ['decide', 'delete']) await expect(dispatcherCommands.find((entry) => entry.id === `logistics.offers.${action}`)!.execute({ id: test.offer.id, action: 'reject' }, test.ctx)).rejects.toMatchObject({ status: 409 })
  expect(test.offer.status).toBe('accepted')
  expect(test.flush).not.toHaveBeenCalled()
})
