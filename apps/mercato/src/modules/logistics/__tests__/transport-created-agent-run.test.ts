import type { EntityManager } from '@mikro-orm/postgresql'
import { loadTransportDetail } from '../lib/transports'
import { startTransportRunForTransport } from '../lib/transport-run-source'
import handle, { metadata } from '../subscribers/transport-created-agent-run'
import { metadata as salesMetadata } from '../subscribers/sales-order-created-agent-run'
import { eventsConfig } from '../events'

jest.mock('../lib/transports', () => ({ loadTransportDetail: jest.fn() }))
jest.mock('../lib/transport-run-source', () => ({
  startTransportRunForTransport: jest.fn(),
}))
jest.mock('../events', () => ({ eventsConfig: { emit: jest.fn() } }))

const scope = { tenantId: 'tenant-1', organizationId: 'organization-1' }
const fork = jest.fn()
const em = { fork } as unknown as EntityManager

beforeEach(() => {
  jest.clearAllMocks()
  fork.mockReturnValue(em)
})

test('is an inline subscriber for the existing process-local demo projection', () => {
  expect(metadata).toEqual({
    event: 'logistics.transport.created',
    persistent: false,
    id: 'logistics:transport-created-agent-run',
  })
  expect(salesMetadata).toEqual({
    event: 'sales.order.created',
    persistent: false,
    id: 'logistics:sales-order-created-agent-run',
  })
})

test('loads and starts a transport run using trusted event scope', async () => {
  const transport = { order1: { id: 'transport-1' } }
  jest.mocked(loadTransportDetail).mockResolvedValue(transport as never)
  jest.mocked(startTransportRunForTransport).mockResolvedValue({ id: 'run-1' } as never)

  await handle(
    { id: 'transport-1' },
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      resolve: () => em,
    },
  )

  expect(loadTransportDetail).toHaveBeenCalledWith(em, scope, 'transport-1')
  expect(startTransportRunForTransport).toHaveBeenCalledWith(transport, scope)
  expect(eventsConfig.emit).toHaveBeenCalledWith(
    'logistics.transport_run.started',
    { id: 'run-1', sourceTransportId: 'transport-1' },
    scope,
  )
})

test('ignores payload scope when trusted event scope is missing', async () => {
  await handle({ id: 'transport-1' }, { resolve: () => em })

  expect(loadTransportDetail).not.toHaveBeenCalled()
  expect(startTransportRunForTransport).not.toHaveBeenCalled()
})
