import { webhookBodySchema } from '../data/validators'

export const MAX_BODY_BYTES = 64 * 1024

export class InboxBodyError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super('[internal] Invalid diagnostic webhook body')
  }
}

export async function readWebhookBody(req: Request): Promise<{ body: Record<string, unknown>; bytes: number; contentType: string }> {
  const contentType = req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
  if (contentType !== 'application/json' && !/^application\/[a-z0-9.+-]+\+json$/.test(contentType)) {
    throw new InboxBodyError(415, 'unsupportedContentType')
  }
  if (Number(req.headers.get('content-length')) > MAX_BODY_BYTES) throw new InboxBodyError(413, 'bodyTooLarge')
  const reader = req.body?.getReader()
  if (!reader) throw new InboxBodyError(400, 'invalidBody')
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new InboxBodyError(413, 'bodyTooLarge')
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new InboxBodyError(400, 'invalidBody')
  }
  const result = webhookBodySchema.safeParse(parsed)
  if (!result.success) throw new InboxBodyError(400, 'invalidBody')
  return { body: result.data, bytes, contentType }
}
