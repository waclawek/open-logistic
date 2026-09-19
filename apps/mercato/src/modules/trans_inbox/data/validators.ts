import { z } from 'zod'

export const inboxScopeSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

export const webhookParamsSchema = z.object({
  provider: z.enum(['trans', 'timocom', 'eurodebt']),
  channel: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/),
})

export const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
})

export const webhookBodySchema = z.record(z.string(), z.unknown())
export type InboxScope = z.infer<typeof inboxScopeSchema>
