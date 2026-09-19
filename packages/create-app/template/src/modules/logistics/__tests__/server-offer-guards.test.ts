import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { guardAllocatedOffer } from '../lib/server-offer-guards'
import type { LogisticsOffer } from '../data/entities'
import { runMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

jest.mock('@open-mercato/shared/lib/crud/mutation-guard-registry', () => ({ runMutationGuards: jest.fn(), bridgeLegacyGuard: () => null }))
jest.mock('@open-mercato/shared/lib/crud/mutation-guard-store', () => ({ getAllMutationGuardInstances: () => [] }))
jest.mock('@open-mercato/shared/lib/crud/optimistic-lock-command', () => ({ enforceCommandOptimisticLockWithGuards: jest.fn() }))

it('uses child version and scope for every allocation guard, preserving original request headers', async () => {
  jest.mocked(runMutationGuards).mockResolvedValue({ ok: true, afterSuccessCallbacks: [] })
  const parentVersion = '2026-09-19T10:00:00.000Z'
  const childVersion = '2026-09-18T10:00:00.000Z'
  const ctx = { auth: { sub: 'user' }, request: new Request('http://localhost', { headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: parentVersion, 'x-om-ext-record-locks-token': 'lock-token' } }), container: { resolve: () => ({ getGrantedFeatures: async () => ['logistics.*'] }) } } as unknown as CommandRuntimeContext
  const offer = { id: 'offer', tenantId: 'tenant', organizationId: 'org', updatedAt: new Date(childVersion) } as LogisticsOffer
  const after = await guardAllocatedOffer(ctx, offer, { status: 'review', allocatedTransportId: null })
  const guarded = jest.mocked(runMutationGuards).mock.calls[0][1]
  expect(guarded).toMatchObject({ resourceKind: 'logistics.offer', resourceId: 'offer', tenantId: 'tenant', organizationId: 'org' })
  expect(guarded.requestHeaders.get(OPTIMISTIC_LOCK_HEADER_NAME)).toBe(childVersion)
  expect(guarded.requestHeaders.get('x-om-ext-record-locks-token')).toBe('lock-token')
  expect(ctx.request!.headers.get(OPTIMISTIC_LOCK_HEADER_NAME)).toBe(parentVersion)
  expect(enforceCommandOptimisticLockWithGuards).toHaveBeenCalledWith(ctx.container, expect.objectContaining({ resourceId: 'offer', request: guarded.requestHeaders }))
  await after()
})
