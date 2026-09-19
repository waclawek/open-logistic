import { createHmac, randomBytes } from 'node:crypto'
import { GenCtx, intBetween, pick, rng } from './common'

const COUNTRIES = [
  { code: 'PL', vatLen: 10 },
  { code: 'DE', vatLen: 9 },
  { code: 'CZ', vatLen: 8 },
  { code: 'AT', vatLen: 9 },
  { code: 'NL', vatLen: 12 },
  { code: 'FR', vatLen: 11 },
] as const

const COMPANY_NAMES = [
  'Przykładowa Firma Sp. z o.o.',
  'Euro Haulage GmbH',
  'Spedycja Bałtyk S.A.',
  'Logistyka Centrum Sp. j.',
  'Carrier Express s.r.o.',
  'TransAlp AG',
]

function mongoLikeId(rand: () => number): string {
  // 24 hex chars — matches OpenAPI pattern ^[a-f\d]{24}$
  let out = ''
  for (let i = 0; i < 24; i++) {
    out += Math.floor(rand() * 16).toString(16)
  }
  return out
}

function vatNumber(rand: () => number, len: number): string {
  let out = ''
  for (let i = 0; i < len; i++) out += String(intBetween(rand, 0, 9))
  return out
}

function companyName(rand: () => number, ctx: GenCtx): string {
  if (typeof ctx.vars?.companyName === 'string') return ctx.vars.companyName
  return `${pick(rand, [...COMPANY_NAMES])} #${ctx.index + 1}`
}

/** POST /verification/submit body */
export function verificationSubmit(ctx: GenCtx) {
  const rand = rng(ctx)
  const country = pick(rand, [...COUNTRIES])
  const type = String(ctx.vars?.type ?? pick(rand, ['company', 'carrier']))
  const webhookUrl =
    typeof ctx.vars?.webhookUrl === 'string'
      ? ctx.vars.webhookUrl
      : 'http://127.0.0.1:3000/api/integrations/eurodebt/webhooks/verification'

  return {
    type,
    countryCode: String(ctx.vars?.countryCode ?? country.code),
    vatNumber: String(ctx.vars?.vatNumber ?? vatNumber(rand, country.vatLen)),
    companyName: companyName(rand, ctx),
    webhookUrl,
  }
}

/** Outbound Eurodebt webhook payload (verificationCompleted). */
export function verificationCompletedWebhook(ctx: GenCtx) {
  const rand = rng(ctx)
  const country = pick(rand, [...COUNTRIES])
  const status = String(ctx.vars?.status ?? (rand() < 0.85 ? 'completed' : 'rejected'))
  const created = new Date(Date.now() - intBetween(rand, 60, 3600) * 1000)
  const completed = new Date()
  const type = String(ctx.vars?.type ?? pick(rand, ['company', 'carrier']))

  const payload: Record<string, unknown> = {
    apiVersion: '1.0',
    requestId: String(ctx.vars?.requestId ?? mongoLikeId(rand)),
    countryCode: String(ctx.vars?.countryCode ?? country.code),
    vatNumber: String(ctx.vars?.vatNumber ?? vatNumber(rand, country.vatLen)),
    companyName: companyName(rand, ctx),
    type,
    status,
    dateCreated: created.toISOString(),
    dateCompleted: completed.toISOString(),
  }

  if (status === 'completed') {
    payload.verificationId = Number(ctx.vars?.verificationId ?? intBetween(rand, 10_000, 99_999))
    payload.rejectReason = null
  } else {
    payload.rejectReason = String(
      ctx.vars?.rejectReason ?? 'Invalid VAT number or company not found in register',
    )
  }

  return payload
}

/** Signed webhook envelope helpers for mock-server / custom callers. */
export function signWebhookPayload(body: string, secret: string): string {
  const hex = createHmac('sha256', secret).update(body).digest('hex')
  return `sha256=${hex}`
}

export function randomWebhookSecret(): string {
  return randomBytes(24).toString('hex')
}
