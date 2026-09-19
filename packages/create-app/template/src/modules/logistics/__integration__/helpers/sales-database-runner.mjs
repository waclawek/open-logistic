import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { asValue } from 'awilix'
import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getOrm } from '@open-mercato/shared/lib/db/mikro'
import { getAllCommandInterceptors, registerCommandInterceptors } from '@open-mercato/shared/lib/commands/command-interceptor-store'
import { getGlobalEventBus, setGlobalEventBus } from '@open-mercato/shared/modules/events'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import { CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'

if (process.env.OM_INTEGRATION_TEST !== 'true' || !process.env.DATABASE_URL) throw new Error('Explicit managed integration database required')
const input = JSON.parse(process.env.LOGISTICS_DB_TEST_INPUT ?? '{}')
const appRoot = path.resolve(process.env.OM_TEST_APP_ROOT || process.cwd())
await bootstrapFromAppRoot(appRoot)
const container = await createRequestContainer()
const orm = await getOrm()
const em = container.resolve('em').fork()
const bus = container.resolve('commandBus')
const beforeInterceptors = getAllCommandInterceptors()
const globalBus = getGlobalEventBus()
const eventBus = container.resolve('eventBus')
const parent = await em.findOneOrFail(SalesOrder, { id: input.transportId, organizationId: input.organizationId, deletedAt: null })
const scope = { tenantId: parent.tenantId, organizationId: parent.organizationId }
const ctx = { container, auth: null, systemActor: true, selectedOrganizationId: scope.organizationId, organizationIds: [scope.organizationId], organizationScope: { selectedId: scope.organizationId, filterIds: [scope.organizationId], allowedIds: [scope.organizationId], tenantId: scope.tenantId } }
const Offer = orm.getMetadata().get('LogisticsOffer').class
const LegacyTransport = orm.getMetadata().get('LogisticsTransport').class
const registered = beforeInterceptors.map((entry) => ({ moduleId: entry.moduleId, interceptors: [entry.interceptor] }))
const emitted = []
let createdOrderId = null

try {
  if (input.mode === 'rollback') {
    const initialVersion = parent.updatedAt.toISOString()
    const initialOffer = await em.findOneOrFail(Offer, { ...scope, id: input.offerId })
    const originalOfferVersion = initialOffer.updatedAt.toISOString()
    container.register({ eventBus: asValue(new Proxy(eventBus, { get(target, key) {
      if (key === 'emitEvent' || key === 'emit') return async (name, ...args) => {
        if (/^sales\.(line|document)\.calculate\.(before|after)$/.test(name)) return target[key](name, ...args)
        emitted.push({ name, payload: args[0] })
      }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })) })
    setGlobalEventBus({ emit: async (name, payload) => { emitted.push({ name, payload }) } })
    registerCommandInterceptors([...registered, { moduleId: 'logistics_test', interceptors: [{
      id: 'logistics_test.fail-parent', targetCommand: 'sales.orders.*',
      async afterExecute(_payload, result, context) {
        if (context.commandId === 'sales.orders.create') createdOrderId = result.orderId
      },
      async beforeExecute(payload, context) {
        if (context.commandId === 'sales.orders.update' && payload.id === parent.id) {
          assert.ok(createdOrderId, 'Fault must occur after a successful child Sales create')
          throw new Error('logistics_test_parent_update_failed')
        }
      },
    }] }])
    await assert.rejects(() => bus.execute('logistics.transports.decide', { input: { id: parent.id, action: 'accept_load', offerId: input.offerId }, ctx }), /logistics_test_parent_update_failed/)
    em.clear()
    assert.ok(createdOrderId)
    assert.equal(await em.count(SalesOrder, { ...scope, id: createdOrderId }), 0)
    assert.equal(await em.count(CustomFieldValue, { ...scope, entityId: 'sales:sales_order', recordId: createdOrderId }), 0)
    const afterParent = await em.findOneOrFail(SalesOrder, { ...scope, id: parent.id })
    const afterOffer = await em.findOneOrFail(Offer, { ...scope, id: input.offerId })
    assert.equal(afterParent.updatedAt.toISOString(), initialVersion)
    assert.equal(afterOffer.updatedAt.toISOString(), originalOfferVersion)
    assert.equal(afterOffer.allocatedTransportId ?? null, null)
    assert.equal(afterOffer.status, 'new')
    assert.deepEqual(emitted, [], 'No lifecycle, totals, notification, CRUD or index effects may escape rollback')
    const notificationMeta = orm.getMetadata().find('Notification')
    if (notificationMeta) assert.equal(await em.count(notificationMeta.class, { ...scope, sourceEntityId: createdOrderId }), 0)
    process.stdout.write(`${JSON.stringify({ ok: true, childCreatedBeforeFault: true, rolledBack: true, effects: emitted.length })}\n`)
  } else if (input.mode === 'migration') {
    const stamp = randomUUID()
    const legacy = em.create(LegacyTransport, { ...scope, reference: `QA-LEGACY-${stamp}`, customer: 'QA legacy customer', origin: 'Warszawa', destination: 'Berlin', pickupDate: '2026-09-21', deliveryDate: '2026-09-22', order1: { id: 'legacy-order-1', status: 'confirmed', cargo: { weightKg: 1000, palletSpaces: 2 } }, order2: { id: 'legacy-order-2', status: 'confirmed', carrier: 'QA legacy carrier', vehicle: { registration: 'QA-MIG', typeKey: 'FTL', capacity: { weightKg: 5000, palletSpaces: 10 } } }, additionalLoads: [] })
    em.persist(legacy)
    await em.flush()
    const offer = em.create(Offer, { ...scope, reference: `QA-LEGACY-OFFER-${stamp}`, customer: 'QA legacy load', origin: 'Warszawa', destination: 'Berlin', pickupDate: '2026-09-21', deliveryDate: '2026-09-22', cargo: { weightKg: 500, palletSpaces: 1 }, priceEur: 100, source: 'email', status: 'accepted', allocatedTransportId: legacy.id })
    em.persist(offer)
    await em.flush()
    legacy.additionalLoads = [{ id: randomUUID(), offerId: offer.id, orderNumber: 3, cargo: offer.cargo, status: 'confirmed' }]
    await em.flush()
    let migratedId = null
    try {
      const dryRun = (await bus.execute('logistics.transports.migrate', { input: { channelId: parent.channelId, dryRun: true }, ctx })).result
      assert.equal(dryRun.find((row) => row.legacyId === legacy.id).status, 'planned')
      assert.equal(await em.count(SalesOrder, { ...scope, externalReference: `logistics-legacy:${legacy.id}` }), 0)
      const first = (await bus.execute('logistics.transports.migrate', { input: { channelId: parent.channelId }, ctx })).result
      const migrated = first.find((row) => row.legacyId === legacy.id)
      assert.equal(migrated.status, 'migrated')
      migratedId = migrated.salesOrderId
      const second = (await bus.execute('logistics.transports.migrate', { input: { channelId: parent.channelId }, ctx })).result
      assert.equal(second.find((row) => row.legacyId === legacy.id).status, 'existing')
      em.clear()
      assert.equal(await em.count(LegacyTransport, { ...scope, id: legacy.id }), 1)
      assert.equal((await em.findOneOrFail(Offer, { ...scope, id: offer.id })).allocatedTransportId, migratedId)
      const children = await em.find(CustomFieldValue, { ...scope, entityId: 'sales:sales_order', fieldKey: 'transport_parent_id', valueText: migratedId })
      assert.equal(children.length, 2)
      assert.equal(await em.count(SalesOrder, { ...scope, externalReference: `logistics-legacy:${legacy.id}` }), 1)
      process.stdout.write(`${JSON.stringify({ ok: true, idempotent: true, preservedLegacy: true, remappedOffer: true })}\n`)
    } finally {
      if (migratedId) await bus.execute('logistics.transports.delete', { input: { id: migratedId }, ctx })
      await em.nativeDelete(Offer, { ...scope, id: offer.id })
      await em.nativeDelete(LegacyTransport, { ...scope, id: legacy.id })
    }
  } else throw new Error('Unsupported integration mode')
} finally {
  registerCommandInterceptors(registered)
  if (globalBus) setGlobalEventBus(globalBus)
  await container.dispose()
  await orm.close(true)
}
