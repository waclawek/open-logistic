import { z } from 'zod'
import { commandActionSchema } from '../data/commandValidators'
import { uuidSchema } from '../data/validators'
import { digestCommandInput } from './commandInput'

const requestKey = Symbol.for('logistics.receipt.request')
const requestSchema = z.object({ action: commandActionSchema, requestId: uuidSchema, recordId: uuidSchema.nullable(), inputDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict()

export function readReceiptRequest(request?: Request) {
  const value: unknown = request ? Reflect.get(request, requestKey) : undefined
  return value === undefined ? null : requestSchema.parse(value)
}

export async function withReceiptRequest<Result>(request: Request, action: string, input: Record<string, unknown>, run: () => Promise<Result>): Promise<Result> {
  const value = requestSchema.parse({ action, requestId: input.requestId, recordId: input.id ?? null, inputDigest: digestCommandInput(input) })
  Object.defineProperty(request, requestKey, { value, configurable: true })
  try { return await run() } finally { Reflect.deleteProperty(request, requestKey) }
}
