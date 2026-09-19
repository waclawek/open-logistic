import { z } from 'zod'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { LogisticsRequestContextError } from '../lib/request-context'
import { logisticsError } from '../lib/server-domain'

export async function logisticsResponse(run: () => Promise<Response>): Promise<Response> {
  try { return await run() }
  catch (error) {
    const rejection = getCommandInterceptorHttpRejection(error)
    if (rejection) return Response.json(rejection.body, { status: rejection.status })
    if (isCrudHttpError(error)) return Response.json(error.body, { status: error.status })
    if (error instanceof LogisticsRequestContextError || error instanceof z.ZodError) {
      try { await logisticsError(error instanceof z.ZodError ? 400 : error.status, error instanceof z.ZodError ? 'invalidInput' : error.code === 'unauthorized' ? 'unauthorized' : 'scopeRequired') }
      catch (translated) { if (isCrudHttpError(translated)) return Response.json(translated.body, { status: translated.status }) }
    }
    throw error
  }
}
