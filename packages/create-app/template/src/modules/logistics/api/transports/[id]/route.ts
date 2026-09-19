import { z } from 'zod'
import { resolveLogisticsRequestContext } from '../../../lib/request-context'
import { loadTransportDetail } from '../../../lib/transports'
import { transportDetailSchema } from '../../../data/validators'
import { logisticsError } from '../../../lib/server-domain'
import { logisticsResponse } from '../../response'

const paramsSchema = z.object({ id: z.uuid() })
export const metadata = { GET: { requireAuth: true, requireFeatures: ['logistics.view'] } }
export async function GET(request: Request, context: { params?: { id?: string } | Promise<{ id?: string }> }) {
  return logisticsResponse(async () => {
    const { em, scope } = await resolveLogisticsRequestContext(request)
    const { id } = paramsSchema.parse(await context.params)
    const item = await loadTransportDetail(em, scope, id)
    if (!item) return logisticsError(404, 'notFound')
    return Response.json({ item })
  })
}
export const openApi = { tag: 'Logistics', pathParams: paramsSchema, methods: { GET: { summary: 'Get transport and Sales orders', responses: [{ status: 200, schema: z.object({ item: transportDetailSchema }) }], errors: [{ status: 404 }] } } }
