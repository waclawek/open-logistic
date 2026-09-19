import { z } from 'zod'
import { buildQueryParams } from '@open-mercato/shared/lib/crud/query-params'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { readCommandReceipt } from '../../../commands/transaction'
import { receiptQuerySchema, uuidSchema } from '../../../data/validators'
import { commandResultSchema } from '../../../data/commandValidators'
import { logisticsJson, logisticsRouteError, resolveLogisticsRequest } from '../../../lib/api'

export const metadata = { GET: { requireAuth: true, requireFeatures: ['logistics.view', 'logistics.jobs.manage'] } }

export async function GET(req: Request, { params }: { params: { requestId: string } }) {
  try {
    const ctx = await resolveLogisticsRequest(req)
    const requestId = uuidSchema.parse((await params).requestId)
    const { action } = receiptQuerySchema.parse(buildQueryParams(new URL(req.url).searchParams))
    const result = await readCommandReceipt({ ctx, requestId, action, requiredFeatures: ['logistics.jobs.manage'] })
    return logisticsJson({ committed: result !== null, result })
  } catch (error) { return logisticsRouteError(error) }
}

export const openApi: OpenApiRouteDoc = { tag: 'Logistics', methods: { GET: {
  summary: 'Read the current actor’s committed command receipt', query: receiptQuerySchema,
  responses: [{ status: 200, description: 'Missing receipt does not prove an in-flight command failed',
    schema: z.object({ committed: z.boolean(), result: commandResultSchema.nullable() }) },
    { status: 400, description: 'Invalid action, request identifier or organization selection' },
    { status: 401, description: 'Authentication required' }, { status: 403, description: 'Current action permission required' }],
} } }
