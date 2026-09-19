import type { GenCtx } from './common'
import { verificationCompletedWebhook, verificationSubmit } from './verification'

export type TemplateFn = (ctx: GenCtx) => unknown

const TEMPLATES: Record<string, TemplateFn> = {
  'verification.submit': verificationSubmit,
  'verification.completed': verificationCompletedWebhook,
  'verification.rejected': (ctx) =>
    verificationCompletedWebhook({
      ...ctx,
      vars: { ...(ctx.vars ?? {}), status: 'rejected' },
    }),
  none: () => undefined,
}

export const TEMPLATE_DEFAULT_OPS: Record<string, string> = {
  'verification.submit': 'POST /api/v1.0/verification/submit',
  'verification.completed': 'POST /webhooks/verificationCompleted',
  'verification.rejected': 'POST /webhooks/verificationCompleted',
}

export function listTemplates(): string[] {
  return Object.keys(TEMPLATES).filter((k) => k !== 'none').sort()
}

export function generateBody(template: string | undefined, ctx: GenCtx): unknown {
  if (!template || template === 'none') return undefined
  const fn = TEMPLATES[template]
  if (!fn) {
    throw new Error(
      `[internal] Unknown template "${template}". Available: ${listTemplates().join(', ')}`,
    )
  }
  return fn(ctx)
}

export function deepMerge(base: unknown, overlay: unknown): unknown {
  if (overlay === undefined) return base
  if (overlay === null || typeof overlay !== 'object' || Array.isArray(overlay)) return overlay
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return overlay
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(overlay as Record<string, unknown>)) {
    out[k] = deepMerge(out[k], v)
  }
  return out
}
