import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { emitTransInboxEvent } from '../../../../../events'
import { webhookParamsSchema, webhookBodySchema } from '../../../../../data/validators'
import { authenticateInboxRequest, resolveInboxConfig } from '../../../../../lib/config'
import { inboxError } from '../../../../../lib/errors'
import { pushInboxRequest, sanitizeHeaders } from '../../../../../lib/inbox-store'
import { InboxBodyError, readWebhookBody } from '../../../../../lib/request-body'

const logger = createLogger('trans_inbox')

export const metadata = {
  path: '/integrations/[provider]/webhooks/[channel]',
  POST: {
    requireAuth: false,
    rateLimit: { points: 120, duration: 60, keyPrefix: 'trans_inbox:webhook' },
  },
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ provider: string; channel: string }> | { provider: string; channel: string } },
) {
  const config = resolveInboxConfig()
  if (!config) return inboxError(503, 'disabled')
  if (!authenticateInboxRequest(req.headers, config)) return inboxError(401, 'unauthorized')
  const params = webhookParamsSchema.safeParse(await ctx.params)
  if (!params.success) return inboxError(404, 'unsupportedProvider')
  let parsed: Awaited<ReturnType<typeof readWebhookBody>>
  try {
    parsed = await readWebhookBody(req)
  } catch (error) {
    if (error instanceof InboxBodyError) return inboxError(error.status, error.code)
    throw error
  }
  const scope = { tenantId: config.tenantId, organizationId: config.organizationId }
  const container = await createRequestContainer()
  const guard = await runRouteMutationGuards({
    container,
    req,
    auth: { ...scope, userId: 'trans_inbox.simulator', userFeatures: [] },
    input: { resourceKind: 'trans_inbox.request', operation: 'create', mutationPayload: parsed.body },
  })
  if (!guard.ok) return guard.response
  const body = webhookBodySchema.safeParse(guard.modifiedPayload ?? parsed.body)
  if (!body.success) return inboxError(400, 'invalidBody')
  const url = new URL(req.url)
  const item = pushInboxRequest({
    ...scope,
    source: params.data.provider,
    channel: params.data.channel,
    method: 'POST',
    path: '/api/integrations/' + params.data.provider + '/webhooks/' + params.data.channel,
    status: 202,
    headers: sanitizeHeaders(req.headers),
    query: Object.fromEntries(url.searchParams),
    body: body.data,
    contentType: parsed.contentType,
    bytes: parsed.bytes,
  }, config.token)
  await guard.runAfterSuccess()
  let broadcast = true
  try {
    await emitTransInboxEvent('trans_inbox.request.received', { ...scope, id: item.id }, { ...scope, persistent: false })
  } catch (error) {
    broadcast = false
    logger.warn('Diagnostic inbox broadcast failed', { err: error, requestId: item.id })
    getTelemetryRuntime()?.reportError(error, { module: 'trans_inbox', code: 'trans_inbox.broadcast_failed' })
  }
  return Response.json({
    ok: true,
    id: item.id,
    provider: item.source,
    channel: item.channel,
    receivedAt: item.receivedAt,
    broadcast,
  }, { status: 202 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'TransInbox',
  methods: {
    POST: {
      summary: 'Capture a simulator JSON payload in the development diagnostic inbox',
      description: 'Development only. Requires configured X-Trans-Inbox-Token; the server fixes tenant and organization scope. Maximum body: 64 KiB.',
      requestBody: { schema: webhookBodySchema },
      responses: [{
        status: 202,
        description: 'Captured into the scoped diagnostic inbox',
        schema: z.object({
          ok: z.literal(true), id: z.string().uuid(), provider: z.string(),
          channel: z.string(), receivedAt: z.string(), broadcast: z.boolean(),
        }),
      }],
    },
  },
}
