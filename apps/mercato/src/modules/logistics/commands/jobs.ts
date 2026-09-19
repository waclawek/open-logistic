import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, flushCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { actionSchema, jobInputSchema } from '../data/validators'
import { commandResultSchema, type CommandResult } from '../data/commandValidators'
import { nextRecordVersion, requireRecordVersion } from '../lib/version'
import { emitLogisticsEvent } from '../events'
import { lockDispatchRecords, runReceiptedCommand } from './transaction'

export const acceptJobCommand: CommandHandler<unknown, CommandResult> = {
  id: 'logistics.jobs.accept',
  isUndoable: false,
  outputSchema: commandResultSchema,
  async execute(raw, ctx) {
    const input = actionSchema.parse(raw)
    return runReceiptedCommand({
      ctx, action: 'logistics.jobs.accept', requestId: input.requestId, input, requiredFeatures: ['logistics.jobs.manage'],
      async mutate(em, context) {
        const { jobs: [job] } = await lockDispatchRecords(em, context, { jobIds: [input.id] })
        requireRecordVersion('logistics:transport_job', job, input.expectedUpdatedAt)
        if (job.status !== 'draft' || job.acceptedAt !== null) return context.fail(409, 'jobNotDraft')
        jobInputSchema.parse({
          customerId: job.customerId, customerReference: job.customerReference, cargoDescription: job.cargoDescription,
          weightKg: job.weightKg, isPalletized: job.isPalletized, pallets: job.pallets,
          pickupPlace: job.pickupPlace, deliveryPlace: job.deliveryPlace, notes: job.notes,
          pickupWindowStart: job.pickupWindowStart.toISOString(), pickupWindowEnd: job.pickupWindowEnd.toISOString(),
          deliveryWindowStart: job.deliveryWindowStart.toISOString(), deliveryWindowEnd: job.deliveryWindowEnd.toISOString(),
        })
        job.status = 'ready'
        job.acceptedAt = new Date()
        job.updatedAt = nextRecordVersion(job.updatedAt, job.acceptedAt)
        return {
          records: () => [{ entityType: 'logistics:transport_job', id: job.id, updatedAt: job.updatedAt.toISOString() }],
          async afterCommit() {
            const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')
            await emitCrudSideEffects({ dataEngine, action: 'updated', entity: job,
              identifiers: { id: job.id, ...context.scope }, actorUserId: context.actorUserId,
              indexer: { entityType: 'logistics:transport_job' },
            })
            await flushCrudSideEffects(dataEngine)
            await emitLogisticsEvent('logistics.job.accepted', {
              id: job.id, ...context.scope, actorUserId: context.actorUserId,
              updatedAt: job.updatedAt.toISOString(), occurredAt: job.acceptedAt?.toISOString(), requestId: input.requestId,
            })
          },
        }
      },
    })
  },
  buildLog: ({ result, ctx }) => ({ resourceKind: 'logistics.job', resourceId: result.records[0]?.id,
    tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId,
    payload: { requestId: result.requestId, action: result.action },
  }),
}

registerCommand(acceptJobCommand)
