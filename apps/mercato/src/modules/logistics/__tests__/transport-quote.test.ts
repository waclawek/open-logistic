import { asValue, createContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { InboxActionExecutionContext } from '@open-mercato/shared/modules/inbox-actions'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { inboxActions as salesInboxActions } from '@open-mercato/core/modules/sales/inbox-actions'
import { inboxActions as logisticsInboxActions } from '../inbox-actions'
import { interceptors } from '../commands/interceptors'
import { logisticsQuotePayloadSchema } from '../lib/transport-quote'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))
jest.mock('@open-mercato/core/modules/inbox_ops/data/entities', () => ({ InboxProposalAction: class {} }))

beforeEach(() => {
  jest.clearAllMocks()
})

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const actionId = '33333333-3333-4333-8333-333333333333'
const proposalId = '44444444-4444-4444-8444-444444444444'
const channelId = '55555555-5555-4555-8555-555555555555'

const quotePayload = {
  customerName: 'Client',
  channelId,
  currencyCode: 'EUR',
  lineItems: [{ productName: 'Road freight', quantity: '1', unitPrice: '900' }],
  transport: {
    pickupAddress: 'Warsaw',
    deliveryAddress: 'Berlin',
    pickupWindowStart: '2026-09-21T08:00:00.000Z',
    cargoPallets: 12,
    cargoWeightKg: 8200,
    clientPrice: 900,
    exchangeSource: 'manual' as const,
    exchangeReference: 'RFQ-42',
  },
}

function interceptorContext(em: EntityManager) {
  const container = createContainer()
  container.register({ em: asValue(em) })
  return {
    commandId: 'sales.quotes.create',
    auth: null,
    selectedOrganizationId: organizationId,
    container,
  }
}

test('transport quote payload accepts optional transport fields and strips system-owned fields', () => {
  const parsed = logisticsQuotePayloadSchema.parse({
    ...quotePayload,
    transport: {
      ...quotePayload.transport,
      transportRole: 'carrier',
      transportOrderNumber: 99,
    },
  })

  expect(parsed.transport).toEqual(quotePayload.transport)
  expect(logisticsQuotePayloadSchema.safeParse({
    ...quotePayload,
    transport: { cargoWeightKg: -1 },
  }).success).toBe(false)
})

test('Logistics create_quote delegates execution to the existing Sales action', async () => {
  const salesAction = salesInboxActions.find((action) => action.type === 'create_quote')
  const logisticsAction = logisticsInboxActions.find((action) => action.type === 'create_quote')
  expect(salesAction).toBeDefined()
  expect(logisticsAction).toBeDefined()

  const execute = jest.fn().mockResolvedValue({ result: { quoteId: 'quote-1' } })
  const container = createContainer()
  container.register({ commandBus: asValue({ execute }) })
  const context: InboxActionExecutionContext = {
    em: {},
    userId: 'user-1',
    tenantId,
    organizationId,
    container,
    executeCommand: jest.fn(),
    resolveEntityClass: () => null,
  }

  const result = await logisticsAction!.execute(
    { id: actionId, proposalId, payload: quotePayload },
    context,
  )

  expect(result).toEqual({ createdEntityId: 'quote-1', createdEntityType: 'sales_quote' })
  expect(execute).toHaveBeenCalledWith('sales.quotes.create', expect.objectContaining({
    input: expect.objectContaining({
      tenantId,
      organizationId,
      metadata: {
        source: 'inbox_ops',
        inboxOpsActionId: actionId,
        inboxOpsProposalId: proposalId,
      },
    }),
  }))
})

test('quote interceptor scopes the proposal action lookup and constructs system metadata', async () => {
  const em = {} as EntityManager
  jest.mocked(findOneWithDecryption).mockResolvedValueOnce({ payload: quotePayload } as never)
  const interceptor = interceptors[0]

  const result = await interceptor.beforeExecute!({
    tenantId,
    organizationId,
    metadata: {
      source: 'inbox_ops',
      inboxOpsActionId: actionId,
      inboxOpsProposalId: proposalId,
    },
  }, interceptorContext(em))

  expect(findOneWithDecryption).toHaveBeenCalledWith(
    em,
    expect.any(Function),
    {
      id: actionId,
      proposalId,
      tenantId,
      organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId, organizationId },
  )
  expect(result).toEqual({
    ok: true,
    modifiedInput: {
      metadata: {
        source: 'inbox_ops',
        inboxOpsActionId: actionId,
        inboxOpsProposalId: proposalId,
        logistics: {
          version: 1,
          kind: 'client_transport',
          transportRole: 'client',
          transportOrderNumber: 1,
          ...quotePayload.transport,
        },
      },
    },
  })
})

test('quote interceptor blocks invalid transport data and leaves generic quotes unchanged', async () => {
  const em = {} as EntityManager
  const interceptor = interceptors[0]
  jest.mocked(findOneWithDecryption)
    .mockResolvedValueOnce({ payload: { ...quotePayload, transport: { cargoPallets: -2 } } } as never)
    .mockResolvedValueOnce({ payload: { customerName: 'Client' } } as never)
  const input = {
    tenantId,
    organizationId,
    metadata: {
      source: 'inbox_ops',
      inboxOpsActionId: actionId,
      inboxOpsProposalId: proposalId,
    },
  }

  await expect(interceptor.beforeExecute!(input, interceptorContext(em))).resolves.toMatchObject({
    ok: false,
    status: 422,
  })
  await expect(interceptor.beforeExecute!(input, interceptorContext(em))).resolves.toBeUndefined()
})
