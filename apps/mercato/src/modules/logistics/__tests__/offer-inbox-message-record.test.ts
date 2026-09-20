// The Messages copy of an inbound enquiry.
//
// Core's extraction worker writes it (`inbox_ops/subscribers/extractionWorker.ts`
// step 8c) and this app disables that worker, so the call lives in our
// subscriber instead. These tests pin the two properties that matter: it
// happens on a successful extraction, and it can never take the extraction down
// with it.
import { afterEach, describe, expect, it, jest } from '@jest/globals'
import { getMessageObjectType } from '@open-mercato/core/modules/messages/lib/message-objects-registry'
import handle from '../subscribers/freight-extraction'
import type { FreightExtractionOutcome } from '../lib/offer-automation/extractionOutcome'

jest.mock('@open-mercato/core/modules/inbox_ops/lib/messagesIntegration', () => ({
  createMessageRecordForEmail: jest.fn(),
}))

jest.mock('../lib/offer-automation/freightExtraction', () => ({
  ...(jest.requireActual('../lib/offer-automation/freightExtraction') as Record<string, unknown>),
  runFreightExtraction: jest.fn(),
}))

const { createMessageRecordForEmail } = jest.requireMock(
  '@open-mercato/core/modules/inbox_ops/lib/messagesIntegration',
) as { createMessageRecordForEmail: jest.Mock }
const { runFreightExtraction } = jest.requireMock(
  '../lib/offer-automation/freightExtraction',
) as { runFreightExtraction: jest.Mock }

const PAYLOAD = {
  emailId: 'email-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

const EMAIL_ROW = {
  id: 'email-1',
  subject: 'Quote request: 8 pallets Poznan to Rotterdam',
  cleanedText: 'cleaned body',
  rawText: 'raw body with the whole thread',
  forwardedByAddress: 'marta.nowak@nordwind-spedition.example',
  forwardedByName: 'Marta Nowak',
  status: 'processed',
}

function successOutcome(): FreightExtractionOutcome {
  return {
    mode: 'app',
    emailStatus: 'processed',
    processingError: null,
    proposalId: 'proposal-1',
    proposalSummary: 'Nordwind asks for groupage.',
    proposalConfidence: '0.90',
    llmModel: 'openai/gpt-4.1-mini',
    llmTokensUsed: 120,
    actions: [],
    waitedMs: 10,
    timedOut: false,
  }
}

function refusalOutcome(): FreightExtractionOutcome {
  return {
    ...successOutcome(),
    emailStatus: 'failed',
    processingError: 'not a freight enquiry',
    proposalId: null,
    proposalSummary: null,
    proposalConfidence: null,
  }
}

/** The only thing the subscriber resolves is `em`, and only to read the row. */
function fakeContainer(email: unknown = EMAIL_ROW) {
  const findOne = jest.fn(async () => email)
  const resolve = (name: string) => {
    if (name !== 'em') throw new Error(`[internal] unexpected resolve(${name})`)
    return { fork: () => ({ findOne }) }
  }
  return { findOne, ctx: { resolve } as unknown as Parameters<typeof handle>[1] }
}

afterEach(() => {
  jest.clearAllMocks()
})

describe('the freight extraction subscriber records the enquiry as a message', () => {
  it('calls core\'s helper with the email and the scope after a successful extraction', async () => {
    runFreightExtraction.mockResolvedValue(successOutcome())
    const { ctx } = fakeContainer()

    await handle(PAYLOAD, ctx)

    expect(createMessageRecordForEmail).toHaveBeenCalledTimes(1)
    const [email, callCtx] = createMessageRecordForEmail.mock.calls[0] as [
      Record<string, unknown>,
      { scope: Record<string, unknown> },
    ]
    expect(email).toMatchObject({
      id: 'email-1',
      subject: EMAIL_ROW.subject,
      rawText: EMAIL_ROW.rawText,
      forwardedByAddress: EMAIL_ROW.forwardedByAddress,
      status: 'processed',
    })
    expect(callCtx.scope).toEqual({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: '00000000-0000-0000-0000-000000000000',
    })
  })

  /**
   * The live failure this covers: a queue worker never runs the app bootstrap
   * that fills the message-object registry, so `messages.messages.compose`
   * rejected the email with "Unsupported message object type".
   */
  it('registers the inbox_email object type the compose command validates against', async () => {
    runFreightExtraction.mockResolvedValue(successOutcome())
    const { ctx } = fakeContainer()

    await handle(PAYLOAD, ctx)

    const objectType = getMessageObjectType('inbox_ops', 'inbox_email')
    expect(objectType?.messageTypes).toContain('inbox_ops.email')
  })

  it('does not fail the extraction when the helper throws', async () => {
    runFreightExtraction.mockResolvedValue(successOutcome())
    createMessageRecordForEmail.mockRejectedValue(new Error('[internal] command bus exploded'))
    const { ctx } = fakeContainer()

    await expect(handle(PAYLOAD, ctx)).resolves.toBeUndefined()
    expect(createMessageRecordForEmail).toHaveBeenCalledTimes(1)
  })

  it('survives an email row that disappeared before the message was written', async () => {
    runFreightExtraction.mockResolvedValue(successOutcome())
    const { ctx } = fakeContainer(null)

    await expect(handle(PAYLOAD, ctx)).resolves.toBeUndefined()
    expect(createMessageRecordForEmail).not.toHaveBeenCalled()
  })

  it('writes no message when the extraction refused the email, exactly like core', async () => {
    runFreightExtraction.mockResolvedValue(refusalOutcome())
    const { ctx } = fakeContainer()

    await handle(PAYLOAD, ctx)

    expect(createMessageRecordForEmail).not.toHaveBeenCalled()
  })
})
