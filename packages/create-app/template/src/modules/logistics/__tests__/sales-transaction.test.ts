import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createContainer, asValue } from 'awilix'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { withSalesTransaction } from '../lib/sales-transaction'

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({ getTelemetryRuntime: () => null }))

function fixture() {
  const state = { persisted: [] as string[], effects: [] as string[], committed: false }
  const transactionContext = { id: 'transaction' }
  const fork = jest.fn((options: { keepTransactionContext?: boolean }) => {
    if (!options.keepTransactionContext) throw new Error('escaped transaction')
    return { transactionContext }
  })
  const em = { fork, flush: jest.fn() }
  const transaction = jest.fn(async (run: (em: object) => Promise<unknown>) => {
    const before = [...state.persisted]
    try { const result = await run(em); state.committed = true; return result }
    catch (error) { state.persisted = before; throw error }
  })
  const markOrmEntityChange = jest.fn(() => { expect(state.committed).toBe(true) })
  const container = createContainer()
  container.register({ em: asValue({ fork: () => ({ transactional: transaction }) }), dataEngine: asValue({ markOrmEntityChange, flushOrmEntityChanges: jest.fn() }) })
  const ctx = { container, auth: null, selectedOrganizationId: null, organizationIds: null, organizationScope: null } satisfies CommandRuntimeContext
  return { state, ctx, fork, transactionContext, markOrmEntityChange }
}

test('inner Sales forks share transaction; effects and callbacks are released only after commit', async () => {
  const test = fixture()
  await withSalesTransaction(test.ctx, async ({ ctx, afterCommit }) => {
    const em = ctx.container.resolve('em')
    expect(em.fork()).toEqual({ transactionContext: test.transactionContext })
    const engine = ctx.container.resolve<DataEngine>('dataEngine')
    engine.markOrmEntityChange({ action: 'created', entity: {}, identifiers: { id: 'order' } })
    await engine.flushOrmEntityChanges()
    expect(test.markOrmEntityChange).not.toHaveBeenCalled()
    afterCommit.push(async () => { expect(test.state.committed).toBe(true); test.state.effects.push('notification') })
    test.state.persisted.push('order')
  })
  expect(test.markOrmEntityChange).toHaveBeenCalledTimes(1)
  expect(test.state.effects).toEqual(['notification'])
})

test('a child command failure rolls back graph and discards deferred effects', async () => {
  const test = fixture()
  await expect(withSalesTransaction(test.ctx, async ({ ctx, afterCommit }) => {
    test.state.persisted.push('parent', 'child')
    ctx.container.resolve<DataEngine>('dataEngine').markOrmEntityChange({ action: 'created', entity: {}, identifiers: { id: 'parent' } })
    afterCommit.push(async () => { test.state.effects.push('notification') })
    throw new Error('child failure')
  })).rejects.toThrow('child failure')
  expect(test.state.persisted).toEqual([])
  expect(test.state.effects).toEqual([])
  expect(test.markOrmEntityChange).not.toHaveBeenCalled()
})
