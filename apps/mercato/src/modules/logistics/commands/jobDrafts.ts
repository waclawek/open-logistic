import { randomUUID } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { parseWithCustomFields, emitCrudSideEffects, flushCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { buildCustomFieldResetMap } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { TransportJob } from '../data/entities'
import { jobCreateSchema, jobUpdateSchema } from '../data/validators'
import { commandResultSchema, type CommandResult } from '../data/commandValidators'
import { nextRecordVersion, requireRecordVersion } from '../lib/version'
import { digestCommandInput } from '../lib/commandInput'
import { setTransactionalCustomFields } from '../lib/customFields'
import { applyJobValues, jobSnapshotSchema, snapshotJob, type JobSnapshot } from '../lib/jobSnapshot'
import { readCustomerSource } from '../services/customerSource'
import { emitLogisticsEvent } from '../events'
import { lockDispatchRecords, runReceiptedCommand } from './transaction'
import type { LogisticsCommandContext } from './context'

const snapshotsKey = Symbol('logistics.job.draft.snapshots')
const undoSchema = z.object({ before: jobSnapshotSchema.nullable(), after: jobSnapshotSchema }).strict()
type DraftResult = CommandResult & { [snapshotsKey]?: z.infer<typeof undoSchema> }
const entityType = 'logistics:transport_job' as const

function assertDraft(job: TransportJob, context: LogisticsCommandContext) {
  if (job.status !== 'draft' || job.acceptedAt || job.firstAssignedAt || job.terminalAt) context.fail(409, 'jobDraftRequired')
}

function effects(ctx: CommandRuntimeContext, context: LogisticsCommandContext, job: TransportJob, action: 'created' | 'updated' | 'deleted', requestId: string) {
  return async () => {
    const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')
    await emitCrudSideEffects({ dataEngine, action, entity: job, identifiers: { id: job.id, ...context.scope },
      actorUserId: context.actorUserId, indexer: { entityType } })
    await flushCrudSideEffects(dataEngine)
    await emitLogisticsEvent(`logistics.job.${action}`, { id: job.id, ...context.scope, actorUserId: context.actorUserId,
      updatedAt: job.updatedAt.toISOString(), requestId })
  }
}

async function customFields(em: EntityManager, ctx: CommandRuntimeContext, context: LogisticsCommandContext, job: TransportJob, values: Record<string, unknown>) {
  await em.flush()
  await setTransactionalCustomFields({ em, container: ctx.container, entityId: entityType, recordId: job.id,
    scope: context.scope, values, validationErrorMessage: context.translate('logistics.errors.invalidInput') })
}

function records(job: TransportJob) {
  return () => [{ entityType, id: job.id, updatedAt: job.updatedAt.toISOString() }]
}

async function writeDraft(raw: unknown, ctx: CommandRuntimeContext, mode: 'create' | 'update'): Promise<DraftResult> {
  const { parsed: input, custom } = parseWithCustomFields(mode === 'create' ? jobCreateSchema : jobUpdateSchema, raw)
  let snapshots: z.infer<typeof undoSchema> | undefined
  const action = `logistics.jobs.${mode}`
  const result = await runReceiptedCommand({ ctx, action, requestId: input.requestId, input: { ...input, customFields: custom },
    requiredFeatures: ['logistics.jobs.manage'], async mutate(em, context) {
      let job: TransportJob
      let before: JobSnapshot | null = null
      if (mode === 'update') {
        const updated = jobUpdateSchema.parse(input)
        const locked = await lockDispatchRecords(em, context, { jobIds: [updated.id] })
        job = locked.jobs[0]
        requireRecordVersion(entityType, job, updated.expectedUpdatedAt)
        assertDraft(job, context)
        before = await snapshotJob(em, job)
      } else {
        const now = new Date()
        job = em.create(TransportJob, { id: randomUUID(), ...context.scope, reference: `JOB-${randomUUID()}`, customerNameSnapshot: '',
          customerId: input.customerId, cargoDescription: input.cargoDescription, weightKg: input.weightKg, isPalletized: input.isPalletized,
          pickupPlace: input.pickupPlace, deliveryPlace: input.deliveryPlace, pickupWindowStart: new Date(input.pickupWindowStart),
          pickupWindowEnd: new Date(input.pickupWindowEnd), deliveryWindowStart: new Date(input.deliveryWindowStart),
          deliveryWindowEnd: new Date(input.deliveryWindowEnd), status: 'draft', createdAt: now, updatedAt: now })
      }
      const queryEngine = ctx.container.hasRegistration('queryEngine') ? ctx.container.resolve<QueryEngine>('queryEngine') : null
      const customer = await readCustomerSource(queryEngine, context, input.customerId)
      applyJobValues(job, input)
      job.customerNameSnapshot = customer.name
      if (before) job.updatedAt = nextRecordVersion(job.updatedAt)
      em.persist(job)
      await customFields(em, ctx, context, job, custom)
      snapshots = { before, after: await snapshotJob(em, job) }
      return { records: records(job), afterCommit: effects(ctx, context, job, mode === 'create' ? 'created' : 'updated', input.requestId) }
    } })
  return Object.assign(result, snapshots ? { [snapshotsKey]: snapshots } : {})
}

function comparable(snapshot: JobSnapshot) {
  const { updatedAt: _version, ...state } = snapshot
  return digestCommandInput(state)
}

function handler(mode: 'create' | 'update'): CommandHandler<unknown, DraftResult> {
  return {
    id: `logistics.jobs.${mode}`, isUndoable: true, outputSchema: commandResultSchema,
    execute: (raw, ctx) => writeDraft(raw, ctx, mode),
    buildLog: ({ result, ctx }) => ({ skipLog: !result[snapshotsKey], resourceKind: entityType, resourceId: result.records[0]?.id,
      tenantId: ctx.auth?.tenantId, organizationId: ctx.selectedOrganizationId,
      snapshotBefore: result[snapshotsKey]?.before, snapshotAfter: result[snapshotsKey]?.after,
      payload: { requestId: result.requestId, action: result.action, undo: result[snapshotsKey] } }),
    async undo({ logEntry, ctx }) {
      const snapshots = undoSchema.parse(extractUndoPayload(logEntry))
      const requestId = randomUUID()
      await runReceiptedCommand({ ctx, action: `logistics.jobs.undo_${mode}`, requestId, input: snapshots,
        requiredFeatures: ['logistics.jobs.manage'], async mutate(em, context) {
          if (snapshots.after.tenantId !== context.scope.tenantId || snapshots.after.organizationId !== context.scope.organizationId) return context.fail(404, 'notFound')
          const { jobs: [job] } = await lockDispatchRecords(em, context, { jobIds: [snapshots.after.id] })
          assertDraft(job, context)
          requireRecordVersion(entityType, job, snapshots.after.updatedAt)
          const current = await snapshotJob(em, job)
          if (comparable(current) !== comparable(snapshots.after)) return context.fail(409, 'undoConflict')
          if (snapshots.before) {
            if (snapshots.before.id !== job.id || snapshots.before.tenantId !== context.scope.tenantId || snapshots.before.organizationId !== context.scope.organizationId) return context.fail(409, 'undoConflict')
            applyJobValues(job, snapshots.before.values)
            job.customerNameSnapshot = snapshots.before.customerNameSnapshot
          } else job.deletedAt = new Date()
          job.updatedAt = nextRecordVersion(job.updatedAt)
          if (snapshots.before) await customFields(em, ctx, context, job, buildCustomFieldResetMap(snapshots.before.custom, snapshots.after.custom))
          return { records: records(job), afterCommit: effects(ctx, context, job, snapshots.before ? 'updated' : 'deleted', requestId) }
        } })
    },
    async redo({ logEntry, ctx }) {
      const snapshots = undoSchema.parse(extractUndoPayload(logEntry))
      let restored: z.infer<typeof undoSchema> | undefined
      const requestId = randomUUID()
      const result = await runReceiptedCommand({ ctx, action: `logistics.jobs.redo_${mode}`, requestId, input: snapshots,
        requiredFeatures: ['logistics.jobs.manage'], async mutate(em, context) {
          const expected = snapshots.before ?? snapshots.after
          if (expected.tenantId !== context.scope.tenantId || expected.organizationId !== context.scope.organizationId) return context.fail(404, 'notFound')
          const job = await findOneWithDecryption(em, TransportJob, { ...context.scope, id: expected.id }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }, context.scope)
          if (!job) return context.fail(404, 'notFound')
          assertDraft(job, context)
          if (Boolean(job.deletedAt) !== (mode === 'create')) return context.fail(409, 'undoConflict')
          const current = await snapshotJob(em, job)
          if (comparable(current) !== comparable(expected)) return context.fail(409, 'undoConflict')
          job.deletedAt = null
          applyJobValues(job, snapshots.after.values)
          job.customerNameSnapshot = snapshots.after.customerNameSnapshot
          job.updatedAt = nextRecordVersion(job.updatedAt)
          await customFields(em, ctx, context, job, buildCustomFieldResetMap(snapshots.after.custom, current.custom))
          restored = { before: mode === 'create' ? null : current, after: await snapshotJob(em, job) }
          return { records: records(job), afterCommit: effects(ctx, context, job, mode === 'create' ? 'created' : 'updated', requestId) }
        } })
      return Object.assign(result, restored ? { [snapshotsKey]: restored } : {})
    },
  }
}

export const createJobCommand = handler('create')
export const updateJobCommand = handler('update')
registerCommand(createJobCommand)
registerCommand(updateJobCommand)
