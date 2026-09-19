import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export async function inboxError(status: number, code: string): Promise<Response> {
  const { translate } = await resolveTranslations()
  return Response.json({ error: translate('trans_inbox.errors.' + code), code }, { status })
}
