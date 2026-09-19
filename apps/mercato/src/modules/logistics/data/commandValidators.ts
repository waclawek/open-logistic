import { z } from 'zod'
import { revisionSchema, utcTimestampSchema, uuidSchema } from './validators'

export const commandActionSchema = z.string().regex(/^logistics\.[a-z_]+\.[a-z_]+$/).max(120)
export const commandRecordSchema = z.object({
  entityType: z.string().regex(/^logistics:[a-z_]+$/).max(120),
  id: uuidSchema,
  updatedAt: utcTimestampSchema,
  planRevision: revisionSchema.optional(),
  factRevision: revisionSchema.optional(),
  ledgerRevision: revisionSchema.optional(),
}).strict()

export const commandResultSchema = z.object({
  requestId: uuidSchema,
  action: commandActionSchema,
  records: z.array(commandRecordSchema),
}).strict()

export type CommandRecord = z.infer<typeof commandRecordSchema>
export type CommandResult = z.infer<typeof commandResultSchema>
