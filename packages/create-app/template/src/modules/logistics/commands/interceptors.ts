import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandInterceptor, CommandInterceptorBeforeResult } from '@open-mercato/shared/lib/commands/command-interceptor'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { InboxProposalAction } from '@open-mercato/core/modules/inbox_ops/data/entities'
import { LOGISTICS_CLIENT_TRANSPORT_KIND, LOGISTICS_METADATA_VERSION } from '../lib/transport-metadata'
import { logisticsQuoteTransportSchema } from '../lib/transport-quote'
import handleTransportCreated from '../subscribers/transport-created-agent-run'

const logger = createLogger('logistics').child({ component: 'command-interceptors' })

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function blockedInvalidTransport(): CommandInterceptorBeforeResult {
  const error = '[internal] Invalid Logistics transport data on Inbox quote action.'
  return { ok: false, status: 422, message: error, body: { error } }
}

const createLogisticsQuoteInterceptor: CommandInterceptor = {
  id: 'logistics.inbox-create-quote',
  targetCommand: 'sales.quotes.create',
  priority: 40,
  async beforeExecute(input, context) {
    const commandInput = record(input)
    const sourceMetadata = record(commandInput?.metadata)
    if (sourceMetadata?.source !== 'inbox_ops') return

    const actionId = sourceMetadata.inboxOpsActionId
    const proposalId = sourceMetadata.inboxOpsProposalId
    const tenantId = commandInput?.tenantId
    const organizationId = commandInput?.organizationId
    if (
      typeof actionId !== 'string' ||
      typeof proposalId !== 'string' ||
      typeof tenantId !== 'string' ||
      typeof organizationId !== 'string'
    ) return blockedInvalidTransport()

    const em = context.container.resolve<EntityManager>('em')
    const action = await findOneWithDecryption(
      em,
      InboxProposalAction,
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
    if (!action) return

    const actionPayload = record(action.payload)
    if (!actionPayload || !Object.prototype.hasOwnProperty.call(actionPayload, 'transport')) return

    const parsed = logisticsQuoteTransportSchema.safeParse(actionPayload.transport)
    if (!parsed.success) return blockedInvalidTransport()

    return {
      ok: true,
      modifiedInput: {
        metadata: {
          ...sourceMetadata,
          logistics: {
            version: LOGISTICS_METADATA_VERSION,
            kind: LOGISTICS_CLIENT_TRANSPORT_KIND,
            transportRole: 'client',
            transportOrderNumber: 1,
            ...parsed.data,
          },
        },
      },
    }
  },
}

const startConvertedTransportRunInterceptor: CommandInterceptor = {
  id: 'logistics.start-converted-transport-run',
  targetCommand: 'sales.quotes.convert_to_order',
  priority: 60,
  async afterExecute(_input, result, context) {
    const orderId = record(result)?.orderId
    const tenantId = context.auth?.tenantId ?? null
    const organizationId = context.selectedOrganizationId ?? context.auth?.orgId ?? null
    if (typeof orderId !== 'string' || !tenantId || !organizationId) return

    try {
      await handleTransportCreated(
        { id: orderId },
        {
          tenantId,
          organizationId,
          resolve: <T = unknown>(name: string) => context.container.resolve<T>(name),
        },
      )
    } catch (error) {
      logger.error('Failed to start Agent Inbox run after quote conversion', { error, orderId })
      getTelemetryRuntime()?.reportError(error, {
        module: 'logistics',
        code: 'logistics.converted_transport_run_failed',
        attributes: { orderId },
      })
    }
  },
}

export const interceptors: CommandInterceptor[] = [
  createLogisticsQuoteInterceptor,
  startConvertedTransportRunInterceptor,
]
