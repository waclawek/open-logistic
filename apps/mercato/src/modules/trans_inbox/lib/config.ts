import { createHash, timingSafeEqual } from 'node:crypto'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { inboxScopeSchema, type InboxScope } from '../data/validators'

export type InboxConfig = InboxScope & { token: string }

export function resolveInboxConfig(env: NodeJS.ProcessEnv = process.env): InboxConfig | null {
  if (env.NODE_ENV !== 'development' || !parseBooleanWithDefault(env.TRANS_INBOX_ENABLED, false)) return null
  const scope = inboxScopeSchema.safeParse({
    tenantId: env.TRANS_INBOX_TENANT_ID?.trim(),
    organizationId: env.TRANS_INBOX_ORGANIZATION_ID?.trim(),
  })
  const token = env.TRANS_INBOX_TOKEN?.trim()
  if (!scope.success || !token || token.length < 32) return null
  return { ...scope.data, token }
}

export function authenticateInboxRequest(headers: Headers, config: InboxConfig): boolean {
  const supplied = headers.get('x-trans-inbox-token') ?? ''
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(supplied), digest(config.token))
}
