import { randomUUID } from 'node:crypto'
import { asValue, createContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomFieldDef, CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { buildCustomFieldResetMap } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { TransportJob } from '../data/entities'
import { applyJobValues, snapshotJob } from '../lib/jobSnapshot'
import { setTransactionalCustomFields } from '../lib/customFields'

jest.mock('@open-mercato/shared/lib/encryption/kms', () => ({ createKmsService: jest.fn(() => ({})) }))

afterEach(() => jest.restoreAllMocks())

it.each([false, true])('round-trips added/cleared scalar and multi-value snapshots through the real adapter (encrypted=%s)', async encrypted => {
  const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const entityId = 'logistics:transport_job' as const
  const job = Object.assign(new TransportJob(), { ...scope, id: randomUUID(), reference: 'T1', customerNameSnapshot: 'Customer', updatedAt: new Date() })
  const place = { label: 'Depot', addressLine: '1 Depot St', city: 'Warsaw', countryCode: 'PL', timezone: 'Europe/Warsaw' }
  applyJobValues(job, { customerId: randomUUID(), cargoDescription: 'Cargo', weightKg: '12.5', isPalletized: false, pallets: null,
    pickupPlace: place, deliveryPlace: place, pickupWindowStart: '2026-09-20T08:00:00.000Z', pickupWindowEnd: '2026-09-20T09:00:00.000Z',
    deliveryWindowStart: '2026-09-20T10:00:00.000Z', deliveryWindowEnd: '2026-09-20T11:00:00.000Z' })
  const definitions = ['priority', 'extra', 'labels'].map(key => Object.assign(new CustomFieldDef(), {
    ...scope, entityId, key, kind: 'text', isActive: true, updatedAt: new Date(), configJson: { encrypted, multi: key === 'labels' },
  }))
  const values: CustomFieldValue[] = []
  const matches = (row: CustomFieldValue, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) => Reflect.get(row, key) === value)
  const manager = {
    isInTransaction: () => true, flush: jest.fn(async () => {}), begin: jest.fn(), commit: jest.fn(), rollback: jest.fn(),
    find: jest.fn(async (entity: { name: string }) => entity === CustomFieldDef ? definitions : entity === CustomFieldValue ? values : []),
    findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => values.find(row => matches(row, where)) ?? null),
    nativeDelete: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
      for (let index = values.length - 1; index >= 0; index--) if (matches(values[index], where)) values.splice(index, 1)
    }),
    create: <Entity extends object>(EntityClass: new () => Entity, fields: object) => Object.assign(new EntityClass(), fields),
    persist: (rows: CustomFieldValue[]) => { for (const row of rows) if (!values.includes(row)) values.push(row) },
  }
  const em = manager as unknown as EntityManager
  jest.spyOn(TenantDataEncryptionService.prototype, 'isEnabled').mockReturnValue(encrypted)
  jest.spyOn(TenantDataEncryptionService.prototype, 'getDek').mockResolvedValue({ tenantId: scope.tenantId, key: Buffer.alloc(32, 7).toString('base64'), fetchedAt: Date.now() })
  const container = createContainer().register('tenantEncryptionService', asValue(new TenantDataEncryptionService(em)))
  const write = (fields: Record<string, unknown>) => setTransactionalCustomFields({ em, container, entityId, recordId: job.id, scope, values: fields, validationErrorMessage: 'Invalid test value' })
  await write({ priority: 'normal', labels: ['one', 'two'] })
  const before = await snapshotJob(em, job)
  expect(before.custom).toEqual({ priority: 'normal', labels: ['one', 'two'] })
  await write({ priority: null, extra: '123', labels: [] })
  const after = await snapshotJob(em, job)
  expect(after.custom).toEqual({ extra: '123' })
  if (encrypted) expect(values.find(row => row.fieldKey === 'extra')?.valueText).not.toBe('123')
  for (let cycle = 0; cycle < 2; cycle++) {
    await write(buildCustomFieldResetMap(before.custom, after.custom))
    expect((await snapshotJob(em, job)).custom).toEqual(before.custom)
    await write(buildCustomFieldResetMap(after.custom, before.custom))
    expect((await snapshotJob(em, job)).custom).toEqual(after.custom)
  }
  expect(manager.commit).not.toHaveBeenCalled()
  expect(manager.begin).not.toHaveBeenCalled()
})
