import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi/types'
import { authorizeLogisticsCommand } from '../../../../commands/context'
import { actionSchema, acceptJobBodySchema, uuidSchema } from '../../../../data/validators'
import { commandResultSchema, type CommandResult } from '../../../../data/commandValidators'
import { logisticsJson, logisticsRouteError, resolveLogisticsRequest } from '../../../../lib/api'
import { readCommandReceipt } from '../../../../commands/transaction'
import { digestCommandInput } from '../../../../lib/commandInput'
import { withReceiptRequest } from '../../../../lib/receiptRequest'

export const metadata = { POST: { requireAuth: true, requireFeatures: ['logistics.view', 'logistics.jobs.manage'] } }

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await resolveLogisticsRequest(req)
    const context = await authorizeLogisticsCommand(ctx, ['logistics.jobs.manage'])
    const id = uuidSchema.parse((await params).id)
    const input = { ...acceptJobBodySchema.parse(await readJsonSafe(req, null)), id }
    const action = 'logistics.jobs.accept'
    const committed = await readCommandReceipt({ ctx, action, requestId: input.requestId, inputDigest: digestCommandInput(input), requiredFeatures: ['logistics.jobs.manage'] })
    if (committed) return logisticsJson(committed)
    const guard = await runRouteMutationGuards({ container: ctx.container, req,
      auth: { userId: context.actorUserId, ...context.scope, userFeatures: context.permissions.unrestricted ? ['*'] : context.permissions.grantedFeatures },
      input: { resourceKind: 'logistics.job', resourceId: id, operation: 'update', mutationPayload: input },
    })
    if (!guard.ok) return logisticsJson(guard.errorBody, guard.errorStatus)
    const guardedInput = actionSchema.parse(guard.modifiedPayload ?? input)
    if (guardedInput.id !== id || guardedInput.requestId !== input.requestId) return context.fail(400, 'invalidInput')
    const bus = ctx.container.resolve<CommandBus>('commandBus')
    const { result } = await withReceiptRequest(req, action, input, () => bus.execute<unknown, CommandResult>(action, { input: guardedInput, ctx }))
    await guard.runAfterSuccess()
    return logisticsJson(commandResultSchema.parse(result))
  } catch (error) { return logisticsRouteError(error) }
}

export const openApi: OpenApiRouteDoc = { tag: 'Logistics', methods: { POST: {
  summary: 'Accept a complete draft job into the ready queue', requestBody: { schema: acceptJobBodySchema },
  responses: [{ status: 200, description: 'Committed result or original receipt', schema: commandResultSchema },
    { status: 400, description: 'Invalid input or missing organization selection' }, { status: 401, description: 'Authentication required' },
    { status: 403, description: 'Access denied' }, { status: 404, description: 'Job not found' }, { status: 409, description: 'Version, state or receipt conflict' }],
} } }
