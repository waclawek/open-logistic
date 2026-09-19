import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { ALL_ORGANIZATIONS_COOKIE_VALUE } from '@open-mercato/core/modules/directory/constants'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { deserializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { commandResultSchema } from '../data/commandValidators'
import { test, expect } from './helpers/fixtures'

export const integrationMeta = { dependsOnModules: ['customers'] }
const recordSchema = z.object({ id: z.string().uuid(), updatedAt: z.string().datetime(), status: z.string(), cargoDescription: z.string(), customerNameSnapshot: z.string() })
const listSchema = z.object({ items: z.array(recordSchema), total: z.number() })
const createdSchema = commandResultSchema.extend({ id: z.string().uuid(), updatedAt: z.string().datetime() })
const writeFeatures = ['logistics.view', 'logistics.jobs.manage', 'customers.companies.view', 'customers.companies.manage']

// Receipts and accepted work are retained until the CLI-owned disposable database teardown.
// The existing fixture removes its own user, roles and organization in finally.
test.beforeEach(() => test.skip(!parseBooleanWithDefault(process.env.OM_INTEGRATION_TEST, false), 'Retained operational fixtures require the managed ephemeral runner'))

test('draft CRUD, version conflicts, concurrent acceptance and receipt recovery use one scoped job', async ({ page, logistics }) => {
  await logistics.grant(writeFeatures)
  const name = `QA intake ${randomUUID()}`
  const companyResponse = await page.request.post('/api/customers/companies', { data: { displayName: name } })
  expect(companyResponse.status()).toBe(201)
  const customerId = z.object({ id: z.string().uuid() }).parse(await readJsonSafe(companyResponse)).id
  const place = { label: 'Depot', addressLine: '1 Depot Street', city: 'Warsaw', countryCode: 'PL', timezone: 'Europe/Warsaw' }
  const input = { requestId: randomUUID(), customerId, cargoDescription: 'QA cargo', weightKg: '500.125', isPalletized: true, pallets: 2,
    pickupPlace: place, deliveryPlace: place, pickupWindowStart: '2026-10-01T08:00:00.000Z', pickupWindowEnd: '2026-10-01T09:00:00.000Z',
    deliveryWindowStart: '2026-10-01T12:00:00.000Z', deliveryWindowEnd: '2026-10-01T14:00:00.000Z' }
  const createdResponse = await page.request.post('/api/logistics/jobs', { data: input })
  expect(createdResponse.status()).toBe(201)
  const created = createdSchema.parse(await readJsonSafe(createdResponse))
  const replayResponse = await page.request.post('/api/logistics/jobs', { data: input })
  expect(replayResponse.status()).toBe(201)
  expect(createdSchema.parse(await readJsonSafe(replayResponse))).toEqual(created)
  const listed = await page.request.get(`/api/logistics/jobs?id=${created.id}`)
  expect(listed.status()).toBe(200)
  expect(listed.headers()['cache-control']).toContain('no-store')
  const initial = listSchema.parse(await readJsonSafe(listed))
  expect(initial.total).toBe(1)
  expect(initial.items[0]).toMatchObject({ id: created.id, status: 'draft', customerNameSnapshot: name, cargoDescription: 'QA cargo' })
  const edit = { ...input, requestId: randomUUID(), id: created.id, expectedUpdatedAt: created.updatedAt, cargoDescription: 'QA amended' }
  const editHeaders = { [OPTIMISTIC_LOCK_HEADER_NAME]: created.updatedAt }
  const updatedResponse = await page.request.put('/api/logistics/jobs', { data: edit, headers: editHeaders })
  expect(updatedResponse.status()).toBe(200)
  const updated = createdSchema.parse(await readJsonSafe(updatedResponse))
  expect(updated.updatedAt).not.toBe(created.updatedAt)
  const replayUpdate = await page.request.put('/api/logistics/jobs', { data: edit, headers: editHeaders })
  expect(replayUpdate.status()).toBe(200)
  expect(createdSchema.parse(await readJsonSafe(replayUpdate))).toEqual(updated)
  expect((await page.request.put('/api/logistics/jobs', { data: { ...edit, cargoDescription: 'Changed reuse' }, headers: editHeaders })).status()).toBe(409)
  const stale = await page.request.put('/api/logistics/jobs', { data: { ...edit, requestId: randomUUID() } })
  expect(stale.status()).toBe(409)
  const acceptance = { requestId: randomUUID(), expectedUpdatedAt: updated.updatedAt }
  const path = `/api/logistics/jobs/${created.id}/accept`
  const responses = await Promise.all([page.request.post(path, { data: acceptance }), page.request.post(path, { data: acceptance })])
  expect(responses.map(response => response.status())).toEqual([200, 200])
  const outcomes = await Promise.all(responses.map(async response => commandResultSchema.parse(await readJsonSafe(response))))
  expect(outcomes[1]).toEqual(outcomes[0])
  const receiptResponse = await page.request.get(`/api/logistics/commands/${acceptance.requestId}?action=logistics.jobs.accept`)
  expect(receiptResponse.status()).toBe(200)
  expect(await readJsonSafe(receiptResponse)).toEqual({ committed: true, result: outcomes[0] })
  const currentResponse = await page.request.get(`/api/logistics/jobs?id=${created.id}`)
  const current = listSchema.parse(await readJsonSafe(currentResponse)).items[0]
  expect(current).toMatchObject({ status: 'ready', cargoDescription: 'QA amended' })
  expect((await page.request.put('/api/logistics/jobs', { data: { ...edit, requestId: randomUUID(), expectedUpdatedAt: current.updatedAt } })).status()).toBe(409)
  await logistics.grant(['logistics.view'])
  expect((await page.request.get(`/api/logistics/commands/${acceptance.requestId}?action=logistics.jobs.accept`)).status()).toBe(403)
  expect((await page.request.post(path, { data: acceptance })).status()).toBe(403)
})

test('rejects protected input, invalid cargo, all-organizations selection and missing receipts safely', async ({ page, logistics, baseURL }) => {
  await logistics.grant(writeFeatures)
  expect((await page.request.post('/api/logistics/jobs', { data: { requestId: randomUUID(), status: 'ready' } })).status()).toBe(400)
  const requestId = randomUUID()
  const missing = await page.request.get(`/api/logistics/commands/${requestId}?action=logistics.jobs.accept`)
  expect(missing.status()).toBe(200)
  expect(await readJsonSafe(missing)).toEqual({ committed: false, result: null })
  expect((await page.request.get(`/api/logistics/commands/${requestId}?action=logistics.jobs.accept&action=logistics.jobs.create`)).status()).toBe(400)
  await page.context().addCookies([{ name: 'om_selected_org', value: ALL_ORGANIZATIONS_COOKIE_VALUE, url: baseURL!, sameSite: 'Lax' }])
  expect((await page.request.post(`/api/logistics/jobs/${randomUUID()}/accept`, { data: { requestId, expectedUpdatedAt: '2026-09-19T10:00:00.000Z' } })).status()).toBe(400)
})

test('round-trips decimal drafts through persisted undo/redo and rejects later ABA edits', async ({ page, logistics }) => {
  await logistics.grant([...writeFeatures, 'audit_logs.undo_self', 'audit_logs.redo_self'])
  const customer = await page.request.post('/api/customers/companies', { data: { displayName: `QA undo ${randomUUID()}` } })
  expect(customer.status()).toBe(201)
  const customerId = z.object({ id: z.string().uuid() }).parse(await readJsonSafe(customer)).id
  const place = { label: 'Depot', addressLine: '2 Depot Street', city: 'Warsaw', countryCode: 'PL', timezone: 'Europe/Warsaw' }
  const input = { requestId: randomUUID(), customerId, cargoDescription: 'Original', weightKg: '12.5', isPalletized: false, pallets: null,
    pickupPlace: place, deliveryPlace: place, pickupWindowStart: '2026-10-02T08:00:00.000Z', pickupWindowEnd: '2026-10-02T09:00:00.000Z',
    deliveryWindowStart: '2026-10-02T12:00:00.000Z', deliveryWindowEnd: '2026-10-02T14:00:00.000Z' }
  const createdResponse = await page.request.post('/api/logistics/jobs', { data: input })
  expect(createdResponse.status()).toBe(201)
  const created = createdSchema.parse(await readJsonSafe(createdResponse))
  let operation = deserializeOperationMetadata(createdResponse.headers()['x-om-operation'])
  expect(operation).not.toBeNull()
  const current = async () => {
    const response = await page.request.get(`/api/logistics/jobs?id=${created.id}`)
    expect(response.status()).toBe(200)
    return listSchema.parse(await readJsonSafe(response)).items[0]
  }
  for (let cycle = 0; cycle < 2; cycle++) {
    expect((await current()).cargoDescription).toBe('Original')
    const undone = await page.request.post('/api/audit_logs/audit-logs/actions/undo', { data: { undoToken: operation!.undoToken } })
    expect(undone.status()).toBe(200)
    expect(await current()).toBeUndefined()
    const redone = await page.request.post('/api/audit_logs/audit-logs/actions/redo', { data: { logId: operation!.id } })
    expect(redone.status()).toBe(200)
    operation = deserializeOperationMetadata(redone.headers()['x-om-operation'])
    expect(operation).not.toBeNull()
    expect((await current()).id).toBe(created.id)
  }
  const edit = async (cargoDescription: string) => {
    const record = await current()
    return page.request.put('/api/logistics/jobs', { data: { ...input, requestId: randomUUID(), id: created.id, expectedUpdatedAt: record.updatedAt, cargoDescription },
      headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: record.updatedAt } })
  }
  const edited = await edit('Old edit')
  expect(edited.status()).toBe(200)
  const editOperation = deserializeOperationMetadata(edited.headers()['x-om-operation'])!
  expect(editOperation).not.toBeNull()
  expect((await page.request.post('/api/audit_logs/audit-logs/actions/undo', { data: { undoToken: editOperation.undoToken } })).status()).toBe(200)
  expect((await edit('Intervening edit')).status()).toBe(200)
  expect((await edit('Original')).status()).toBe(200)
  const before = await current()
  const staleRedo = await page.request.post('/api/audit_logs/audit-logs/actions/redo', { data: { logId: editOperation.id } })
  expect(staleRedo.status()).toBe(409)
  expect(await current()).toEqual(before)
})
