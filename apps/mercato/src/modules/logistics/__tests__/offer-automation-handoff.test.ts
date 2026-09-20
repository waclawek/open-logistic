// Explicit imports rather than ambient globals, for the same reason as
// `coreRequiredFeatureShim.test.ts`: `@types/jest` is not in the tsconfig
// typeRoots resolution for this app.
import { describe, expect, it } from '@jest/globals'
import { EXTRACTION_FAILURE_PREFIX } from '../lib/offer-automation/freightExtraction'
import { decideTakeover } from '../subscribers/freight-extraction'
import { describeUnsettled, watchSettled } from '../lib/offer-automation/sendEmailWatch'
import { needsInboxActionRegistryShim } from '../lib/offer-automation/inboxActionRegistry'
import { buildEnquiryEmail } from '../lib/offer-automation/inboundEnquiry'
import { AUTOMATION_USER_FEATURES } from '../lib/offer-automation/automationUser'
import { DRAFT_OFFER_REQUIRED_FEATURE } from '../inbox-actions'
import { assertDraftOfferScope } from '../lib/offer-automation/draftOffer'

/**
 * The pure decisions in this chain, each of which costs money or silence when
 * it is wrong: a takeover that loops calls the model forever, a takeover that
 * never fires loses the quote, and a quote written without a resolved tenant
 * and organization is the one outcome that leaks across tenants.
 */
describe('decideTakeover', () => {
  it('waits while another extractor still holds the email', () => {
    expect(decideTakeover({ status: 'processing' })).toEqual({ action: 'wait' })
    expect(decideTakeover({ status: 'received' })).toEqual({ action: 'wait' })
  })

  it('takes over after another extraction failed', () => {
    expect(
      decideTakeover({
        status: 'failed',
        processingError: 'LLM extraction failed: Invalid schema for response_format',
      }),
    ).toEqual({ action: 'extract' })
  })

  it('never takes over its own refusal twice', () => {
    const decision = decideTakeover({
      status: 'failed',
      processingError: `${EXTRACTION_FAILURE_PREFIX}The model judged this email not to be a freight enquiry`,
    })
    expect(decision.action).toBe('skip')
  })

  it('leaves a finished extraction alone', () => {
    expect(decideTakeover({ status: 'processed' }).action).toBe('skip')
    expect(decideTakeover({ status: 'needs_review' }).action).toBe('skip')
  })
})

describe('inbox-action registry shim', () => {
  it('is skipped under Next and installed in a plain Node worker', () => {
    expect(
      needsInboxActionRegistryShim({ NEXT_RUNTIME: 'nodejs' } as unknown as NodeJS.ProcessEnv),
    ).toBe(false)
    expect(needsInboxActionRegistryShim({} as unknown as NodeJS.ProcessEnv)).toBe(true)
  })
})

describe('the fabricated enquiry', () => {
  const email = buildEnquiryEmail({
    emailId: 'e1',
    messageIdPrefix: '<logistics-offers-send-',
    customerEmail: 'dispatch@acme-freight.example',
    customerName: 'Acme Freight',
    contactName: 'Dispatch Desk',
    tenantId: 't1',
    organizationId: 'o1',
    status: 'received',
    seededBy: 'logistics offers-send-email',
    now: new Date('2026-01-02T03:04:05.000Z'),
  })

  it('arrives in the status every extractor claims from', () => {
    expect(email.status).toBe('received')
  })

  it('carries the sender the pricing and CRM link depend on', () => {
    expect(email.forwardedByAddress).toBe('dispatch@acme-freight.example')
    expect(email.replyTo).toBe(email.forwardedByAddress)
  })

  it('names no sku and no price, because the model has to work that out', () => {
    expect(email.rawText).not.toMatch(/FRT-/)
    expect(email.rawText).not.toMatch(/EUR\s*\d/)
  })

  it('stamps a message id a later run can recognise', () => {
    expect(email.messageId).toBe('<logistics-offers-send-1767323045000@localhost>')
  })
})

/**
 * INVARIANT 4: scoped identity.
 *
 * Tenant, organization and the acting user come from the execution context and
 * never from the payload. A blank in any of the three means the caller could not
 * resolve a scope, and drafting a quote into "no organization" is the one
 * outcome that leaks across tenants. Delete the guard in
 * `lib/offer-automation/draftOffer.ts` and every case below fails.
 */
describe('assertDraftOfferScope', () => {
  const full = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    organizationId: '22222222-2222-4222-8222-222222222222',
    userId: '33333333-3333-4333-8333-333333333333',
  }

  it('passes a fully resolved scope through unchanged', () => {
    expect(assertDraftOfferScope(full)).toEqual(full)
  })

  it.each([
    ['tenantId', { ...full, tenantId: '' }],
    ['organizationId', { ...full, organizationId: '' }],
    ['userId', { ...full, userId: '' }],
    ['tenantId', { ...full, tenantId: '   ' }],
    ['organizationId', { ...full, organizationId: undefined }],
  ])('refuses to draft when %s is missing', (missing, scope) => {
    expect(() => assertDraftOfferScope(scope)).toThrow(new RegExp(missing as string))
  })

  it('names every missing field at once rather than only the first', () => {
    expect(() => assertDraftOfferScope({})).toThrow(/tenantId, organizationId, userId/)
  })
})

describe('the automation account', () => {
  it('holds exactly one feature and it is the one the engine checks', () => {
    expect([...AUTOMATION_USER_FEATURES]).toHaveLength(1)
    expect([...AUTOMATION_USER_FEATURES]).toEqual([DRAFT_OFFER_REQUIRED_FEATURE])
  })
})

describe('watchSettled', () => {
  const base = {
    proposalId: null,
    actionId: null,
    actionStatus: null,
    executionError: null,
    emailStatus: 'received',
    processingError: null,
    quoteId: null,
    quoteNumber: null,
    quoteTotal: null,
    quoteCurrency: null,
    customerEntityId: null,
    executedByUserId: null,
    notificationCount: 0,
  }

  it('keeps watching while core has failed but this module has not had its turn', () => {
    expect(
      watchSettled({
        ...base,
        emailStatus: 'failed',
        processingError: 'LLM extraction failed: Invalid schema for response_format',
      }),
    ).toBe(false)
  })

  it('stops once this module itself refused the email', () => {
    expect(
      watchSettled({
        ...base,
        emailStatus: 'failed',
        processingError: `${EXTRACTION_FAILURE_PREFIX}not a freight enquiry`,
      }),
    ).toBe(true)
  })

  it('stops on a quote and on a failed action', () => {
    expect(watchSettled({ ...base, quoteId: 'q1' })).toBe(true)
    expect(watchSettled({ ...base, actionStatus: 'failed' })).toBe(true)
  })
})

describe('describeUnsettled', () => {
  const base = {
    proposalId: null,
    actionId: null,
    actionStatus: null,
    executionError: null,
    emailStatus: 'received',
    processingError: null,
    quoteId: null,
    quoteNumber: null,
    quoteTotal: null,
    quoteCurrency: null,
    customerEntityId: null,
    executedByUserId: null,
    notificationCount: 0,
  }

  it('blames the missing worker only when the email is untouched', () => {
    expect(describeUnsettled(base)).toBe('nothing-reacted')
  })

  it('says work is in flight once anything has claimed the email', () => {
    expect(describeUnsettled({ ...base, emailStatus: 'processing' })).toBe('still-working')
    expect(
      describeUnsettled({ ...base, processingError: 'LLM extraction failed: ...' }),
    ).toBe('still-working')
    expect(describeUnsettled({ ...base, proposalId: 'p1' })).toBe('still-working')
  })
})
