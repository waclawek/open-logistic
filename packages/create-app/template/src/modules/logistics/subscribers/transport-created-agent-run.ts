import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { loadTransportDetail } from '../lib/transports'
import { startTransportRunForTransport } from '../lib/transport-run-source'
import { eventsConfig } from '../events'

const logger = createLogger('logistics').child({
  component: 'transport-created-agent-run',
})

export const metadata = {
  event: 'logistics.transport.created',
  persistent: false,
  id: 'logistics:transport-created-agent-run',
}

type Payload = { id?: string }
type Context = {
  resolve: <T = unknown>(name: string) => T
  tenantId?: string | null
  organizationId?: string | null
}

export default async function handle(payload: Payload, context: Context): Promise<void> {
  const transportId = typeof payload?.id === 'string' ? payload.id : null
  const tenantId = typeof context.tenantId === 'string' ? context.tenantId : null
  const organizationId = typeof context.organizationId === 'string' ? context.organizationId : null
  if (!transportId || !tenantId || !organizationId) {
    logger.warn('Skipping automatic Agent Inbox run without trusted scope or transport id')
    return
  }

  const scope = { tenantId, organizationId }
  const em = context.resolve<EntityManager>('em').fork({ clear: true })
  const detail = await loadTransportDetail(em, scope, transportId)
  if (!detail) {
    logger.debug('Created record is not a scoped Logistics client transport', {
      transportId,
    })
    return
  }
  const run = await startTransportRunForTransport(detail, scope)
  logger.info('Started Agent Inbox run for transport', {
    transportId,
    runId: run.id,
  })
  await eventsConfig.emit(
    'logistics.transport_run.started',
    { id: run.id, sourceTransportId: transportId },
    { tenantId, organizationId },
  )
}
