import type { EntityManager } from '@mikro-orm/core'
import { beforeEach, expect, it, jest } from '@jest/globals'
import { asValue, createContainer } from 'awilix'
import { setRecordCustomFields } from '@open-mercato/core/modules/entities/lib/helpers'
import { sanitizeCustomFieldHtmlRichTextValuesServer } from '@open-mercato/core/modules/entities/lib/htmlRichTextSanitizer'
import { validateCustomFieldValuesServer } from '@open-mercato/core/modules/entities/lib/validation'
import { decryptCustomFieldValue } from '@open-mercato/shared/lib/encryption/customFieldValues'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { setTransactionalCustomFields, type TransactionalCustomFieldsOptions } from '../lib/customFields'

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({ setRecordCustomFields: jest.fn() }))
jest.mock('@open-mercato/core/modules/entities/lib/htmlRichTextSanitizer', () => ({ sanitizeCustomFieldHtmlRichTextValuesServer: jest.fn() }))
jest.mock('@open-mercato/core/modules/entities/lib/validation', () => ({ validateCustomFieldValuesServer: jest.fn() }))

const sanitize = jest.mocked(sanitizeCustomFieldHtmlRichTextValuesServer)
const validate = jest.mocked(validateCustomFieldValuesServer)
const write = jest.mocked(setRecordCustomFields)
const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }
const entityId = 'logistics:transport_job' as const

function harness(values: TransactionalCustomFieldsOptions['values'] = { priority: 3 }) {
  const manager = {
    isInTransaction: jest.fn(() => true),
    fork: jest.fn(), begin: jest.fn(), commit: jest.fn(), rollback: jest.fn(),
    flush: jest.fn(async () => {}),
  }
  const container = createContainer()
  const emit = jest.fn()
  const invalidate = jest.fn()
  const dataEngine = { setCustomFields: jest.fn(), markOrmEntityChange: jest.fn(), flushOrmEntityChanges: jest.fn() }
  container.register({ eventBus: asValue({ emit }), cache: asValue({ invalidate }), dataEngine: asValue(dataEngine) })
  const resolve = jest.spyOn(container, 'resolve')
  const options: TransactionalCustomFieldsOptions = {
    em: manager as unknown as EntityManager,
    container, entityId, recordId: 'job-1', scope, values,
    validationErrorMessage: 'Translated validation failure',
  }
  return { manager, container, resolve, options, emit, invalidate, dataEngine }
}

beforeEach(() => {
  jest.resetAllMocks()
  sanitize.mockImplementation(async (_em, options) => options.values)
  validate.mockResolvedValue({ ok: true, fieldErrors: {} })
  write.mockResolvedValue(undefined)
})

it('normalizes before sanitization, validates sanitized values, and writes through the same scoped EM', async () => {
  const fixture = harness({ priority: { toString: () => '3' }, notes: '<script>bad()</script><p>safe</p>' })
  const encryptionService = { isEnabled: () => true }
  fixture.container.register('tenantEncryptionService', asValue(encryptionService))
  sanitize.mockResolvedValue({ priority: '3', notes: '<p>safe</p>' })
  await setTransactionalCustomFields(fixture.options)
  expect(sanitize).toHaveBeenCalledWith(fixture.options.em, {
    ...scope, entityId, values: { priority: '3', notes: '<script>bad()</script><p>safe</p>' },
  })
  expect(validate).toHaveBeenCalledWith(fixture.options.em, {
    ...scope, entityId, values: { priority: '3', notes: '<p>safe</p>' },
  })
  expect(write).toHaveBeenCalledWith(fixture.options.em, {
    ...scope, entityId, recordId: 'job-1', values: { priority: '3', notes: '<p>safe</p>' }, encryptionService: expect.anything(),
  })
  expect(write.mock.calls[0][1].encryptionService).toBe(encryptionService)
  expect(sanitize.mock.invocationCallOrder[0]).toBeLessThan(validate.mock.invocationCallOrder[0])
  expect(validate.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[0])
  expect(fixture.resolve.mock.calls.map(([key]) => key)).toEqual(['tenantEncryptionService'])
  for (const method of [fixture.manager.fork, fixture.manager.begin, fixture.manager.commit, fixture.manager.rollback, fixture.emit, fixture.invalidate, ...Object.values(fixture.dataEngine)]) {
    expect(method).not.toHaveBeenCalled()
  }
})

it.each([undefined, null, {}])('leaves empty custom fields untouched (%p)', async (values) => {
  const fixture = harness()
  fixture.options.values = values
  await setTransactionalCustomFields(fixture.options)
  expect(sanitize).not.toHaveBeenCalled()
  expect(validate).not.toHaveBeenCalled()
  expect(write).not.toHaveBeenCalled()
  expect(fixture.resolve).not.toHaveBeenCalled()
})

it('matches platform undefined-only validation skipping and preserves explicit clears', async () => {
  const fixture = harness({ omitted: undefined })
  await setTransactionalCustomFields(fixture.options)
  expect(validate).not.toHaveBeenCalled()
  expect(write).toHaveBeenLastCalledWith(fixture.options.em, expect.objectContaining({ values: { omitted: undefined }, encryptionService: null }))
  fixture.options.values = { cleared: null, selections: [] }
  await setTransactionalCustomFields(fixture.options)
  expect(validate).toHaveBeenCalledWith(fixture.options.em, { ...scope, entityId, values: { cleared: null, selections: [] } })
  expect(write).toHaveBeenLastCalledWith(fixture.options.em, expect.objectContaining({ values: { cleared: null, selections: [] } }))
})

it.each([{}, { priority: 3 }])('rejects an inactive transaction before any platform calls (%p)', async (values) => {
  const fixture = harness(values)
  fixture.manager.isInTransaction.mockReturnValue(false)
  await expect(setTransactionalCustomFields(fixture.options)).rejects.toThrow('active transaction')
  expect(sanitize).not.toHaveBeenCalled()
  expect(write).not.toHaveBeenCalled()
  expect(fixture.resolve).not.toHaveBeenCalled()
})

it.each(['tenantId', 'organizationId'] as const)('rejects missing trusted %s before any platform calls', async (key) => {
  const fixture = harness()
  fixture.options.scope = { ...scope, [key]: '' }
  await expect(setTransactionalCustomFields(fixture.options)).rejects.toThrow('trusted tenant and organization')
  expect(sanitize).not.toHaveBeenCalled()
  expect(write).not.toHaveBeenCalled()
})

it('preserves platform field errors with a translated 400 and does not write invalid input', async () => {
  const fixture = harness()
  validate.mockResolvedValue({ ok: false, fieldErrors: { cf_priority: 'Invalid priority' } })
  await expect(setTransactionalCustomFields(fixture.options)).rejects.toMatchObject({
    status: 400, body: { error: fixture.options.validationErrorMessage, fields: { cf_priority: 'Invalid priority' } },
  })
  expect(write).not.toHaveBeenCalled()
  expect(fixture.resolve).not.toHaveBeenCalled()
})

it.each(['sanitize', 'validate', 'write'] as const)('propagates %s failure to the transaction owner', async (stage) => {
  const fixture = harness()
  const failure = new Error('platform failure')
  if (stage === 'sanitize') sanitize.mockRejectedValueOnce(failure)
  if (stage === 'validate') validate.mockRejectedValueOnce(failure)
  if (stage === 'write') write.mockRejectedValueOnce(failure)
  await expect(setTransactionalCustomFields(fixture.options)).rejects.toBe(failure)
  if (stage !== 'write') expect(write).not.toHaveBeenCalled()
  expect(fixture.manager.commit).not.toHaveBeenCalled()
  expect(fixture.manager.rollback).not.toHaveBeenCalled()
  expect(fixture.emit).not.toHaveBeenCalled()
  expect(fixture.invalidate).not.toHaveBeenCalled()
})

it('uses the real platform setter to flush a scoped array replacement without committing or firing effects', async () => {
  const fixture = harness({ selections: ['one', 'two'] })
  const actual = jest.requireActual<typeof import('@open-mercato/core/modules/entities/lib/helpers')>('@open-mercato/core/modules/entities/lib/helpers')
  write.mockImplementation(actual.setRecordCustomFields)
  const nativeDelete = jest.fn(async (_entity: unknown, _where: Record<string, unknown>) => 1)
  const create = jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data }))
  const persist = jest.fn()
  Object.assign(fixture.manager, { find: jest.fn(async () => []), nativeDelete, create, persist })
  await setTransactionalCustomFields(fixture.options)
  expect(nativeDelete).toHaveBeenCalledWith(expect.anything(), { ...scope, entityId, recordId: 'job-1', fieldKey: 'selections' })
  expect(persist).toHaveBeenCalledWith([
    expect.objectContaining({ ...scope, entityId, recordId: 'job-1', fieldKey: 'selections', valueText: 'one' }),
    expect.objectContaining({ ...scope, entityId, recordId: 'job-1', fieldKey: 'selections', valueText: 'two' }),
  ])
  expect(nativeDelete.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0])
  expect(fixture.manager.flush).toHaveBeenCalledTimes(1)
  expect(fixture.manager.begin).not.toHaveBeenCalled()
  expect(fixture.manager.commit).not.toHaveBeenCalled()
  expect(write.mock.calls[0][1]).not.toHaveProperty('onChanged')
  expect(fixture.emit).not.toHaveBeenCalled()
  expect(fixture.invalidate).not.toHaveBeenCalled()
})

it('runs real sanitization, validation and encryption before the scoped write (mock database)', async () => {
  const fixture = harness({ notes: '<script>bad()</script><p>safe</p>' })
  sanitize.mockImplementation(jest.requireActual<typeof import('@open-mercato/core/modules/entities/lib/htmlRichTextSanitizer')>('@open-mercato/core/modules/entities/lib/htmlRichTextSanitizer').sanitizeCustomFieldHtmlRichTextValuesServer)
  validate.mockImplementation(jest.requireActual<typeof import('@open-mercato/core/modules/entities/lib/validation')>('@open-mercato/core/modules/entities/lib/validation').validateCustomFieldValuesServer)
  write.mockImplementation(jest.requireActual<typeof import('@open-mercato/core/modules/entities/lib/helpers')>('@open-mercato/core/modules/entities/lib/helpers').setRecordCustomFields)
  const definition = {
    ...scope, key: 'notes', kind: 'multiline', updatedAt: new Date(),
    configJson: { editor: 'htmlRichText', encrypted: true, validation: [{ rule: 'required', message: 'Required' }] },
  }
  const encryptionService = {
    isEnabled: () => true,
    getDek: jest.fn(async (_tenantId: string) => ({ key: Buffer.alloc(32, 7).toString('base64') })),
  }
  fixture.container.register('tenantEncryptionService', asValue(encryptionService))
  const created: Record<string, unknown>[] = []
  const findOne = jest.fn(async (_entity: unknown, _where: Record<string, unknown>) => null)
  Object.assign(fixture.manager, {
    find: jest.fn(async (entity: { name: string }) => entity.name === 'CustomEntity' ? [] : [definition]),
    findOne,
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => { const row = { ...data }; created.push(row); return row }),
    persist: jest.fn(),
  })
  await setTransactionalCustomFields(fixture.options)
  expect(findOne).toHaveBeenCalledWith(expect.anything(), { ...scope, entityId, recordId: 'job-1', fieldKey: 'notes' })
  expect(created).toHaveLength(1)
  expect(created[0].valueText).not.toBe('<p>safe</p>')
  await expect(decryptCustomFieldValue(created[0].valueText, scope.tenantId, encryptionService as unknown as TenantDataEncryptionService)).resolves.toBe('<p>safe</p>')
  expect(encryptionService.getDek).toHaveBeenCalledWith(scope.tenantId)
  expect(fixture.manager.commit).not.toHaveBeenCalled()
  fixture.options.values = { notes: '' }
  await expect(setTransactionalCustomFields(fixture.options)).rejects.toMatchObject({ status: 400, body: { fields: { cf_notes: 'Required' } } })
  expect(created).toHaveLength(1)
  expect(fixture.emit).not.toHaveBeenCalled()
  expect(fixture.invalidate).not.toHaveBeenCalled()
})
