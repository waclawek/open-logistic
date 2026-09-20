import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
// Knowing exception, documented in `lib/offer-automation/freightExtraction.ts`: the installed
// `InboxEmail` row is READ here to find out who won the claim. No entity of
// ours is involved and nothing is written outside core's own extraction path.
import { InboxEmail } from '@open-mercato/core/modules/inbox_ops/data/entities'
import { createMessageRecordForEmail } from '@open-mercato/core/modules/inbox_ops/lib/messagesIntegration'
import { EXTRACTION_FAILURE_PREFIX, runFreightExtraction } from '../lib/offer-automation/freightExtraction'
import { POLL_INTERVAL_MS, sleep } from '../lib/offer-automation/poll'

/**
 * Turns an inbound email into a proposal, without anybody asking it to.
 *
 * HOW THE RACE WITH CORE'S OWN EXTRACTOR IS RESOLVED
 * --------------------------------------------------
 * `inbox_ops` subscribes to this same event with its own extraction worker
 * (`inbox_ops:extraction-worker`). The event bus runs every persistent
 * subscriber for one event CONCURRENTLY (`@open-mercato/events/src/bus.ts`
 * `dispatchQueued` uses `Promise.allSettled`), so both handlers start at the
 * same instant and both try the same optimistic claim on `inbox_emails.status`.
 * Exactly one wins, and which one is a coin toss.
 *
 * That coin toss is not survivable here, because core's worker CANNOT produce
 * the action this flow needs: its output contract pins `actionType` to a closed
 * enum of nine built-ins with no `draft_offer`
 * (`packages/core/src/modules/inbox_ops/data/validators.ts`,
 * `extractedActionSchema`). A run core wins ends with a `create_quote` carrying
 * model-written prices, or with nothing.
 *
 * So this app DISABLES core's worker, in `apps/mercato/src/modules.ts` under
 * the `inbox_ops` entry:
 *
 *   overrides: { events: { subscribers: { 'inbox_ops:extraction-worker': null } } }
 *
 * With that override in place this handler always wins the claim from
 * `received` and the takeover loop below never runs.
 *
 * THE TAKEOVER LOOP IS KEPT ANYWAY. Remove the override and the two race again,
 * and then:
 *
 *   we win    core's worker finds 0 rows claimed and returns; we extract.
 *   core wins we wait for its verdict. On a failure (the usual outcome on an
 *             OpenAI install, see `lib/offer-automation/freightExtraction.ts`)
 *             we claim the email from `failed` and extract. On a SUCCESS we
 *             stand down, and the proposal then carries core's built-in actions
 *             instead of a `draft_offer`, so no quote is drafted from the
 *             catalogue.
 *
 * IDEMPOTENCY
 * -----------
 * Three guards, all of them atomic or read-only:
 *  1. the claim is a single `UPDATE ... WHERE status = ?`, so two runners can
 *     never both extract;
 *  2. a re-delivered job finds the email in `processed` / `needs_review` and
 *     returns without calling the model;
 *  3. our own refusal is marked on `processing_error` with
 *     `EXTRACTION_FAILURE_PREFIX`, so a re-delivery cannot take the email over
 *     a second time and spend another model call on an email we already judged.
 *
 * THE MESSAGES COPY
 * -----------------
 * Disabling core's worker also drops the ONE call that puts an inbound email in
 * the Messages inbox. `recordInboxMessage` below restores it. See its own note
 * for the ordering and why it can never fail the extraction.
 */
export const metadata = {
  event: 'inbox_ops.email.received',
  persistent: true,
  id: 'logistics:offer-freight-extraction',
}

type EmailReceivedPayload = {
  emailId: string
  tenantId: string
  organizationId: string
  forwardedByAddress?: string
  subject?: string
}

type ResolverContext = { resolve: <T = unknown>(name: string) => T }

const logger = createLogger('logistics').child({ component: 'inbound-email-extraction' })

/** How long to wait for the other runner's verdict before giving up. */
const TAKEOVER_TIMEOUT_MS = 120_000

/**
 * Actor recorded on the message record. Same zero UUID core's worker passes
 * (`inbox_ops/subscribers/extractionWorker.ts`); the helper resolves a real
 * sender itself and only falls back to this.
 */
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000'

/** Statuses that mean nobody is working on the email any more. */
const SETTLED_STATUSES = new Set(['processed', 'needs_review', 'failed'])

export type TakeoverDecision =
  | { action: 'extract' }
  | { action: 'skip'; reason: string }
  | { action: 'wait' }

/**
 * What to do with an email this handler did not manage to claim.
 *
 * Pure, and unit-tested, because it is the piece that decides whether a second
 * model call happens. Getting it wrong is either a missing quote or an endless
 * retry loop that bills for every attempt.
 */
export function decideTakeover(email: {
  status: string
  processingError?: string | null
}): TakeoverDecision {
  if (!SETTLED_STATUSES.has(email.status)) return { action: 'wait' }
  if (email.status !== 'failed') {
    return { action: 'skip', reason: `another extraction finished it (status ${email.status})` }
  }
  if ((email.processingError ?? '').startsWith(EXTRACTION_FAILURE_PREFIX)) {
    return { action: 'skip', reason: 'this module already extracted it and refused' }
  }
  return { action: 'extract' }
}

export default async function handle(
  payload: EmailReceivedPayload,
  ctx: ResolverContext,
): Promise<void> {
  // The subscriber context exposes `resolve`, which is every dependency
  // `runFreightExtraction` reads. Same cast `lib/liveExtraction.ts` makes in
  // the other direction, for the same reason.
  const container = ctx as unknown as AwilixContainer
  const scope = { tenantId: payload.tenantId, organizationId: payload.organizationId }

  const claimed = await tryExtract(container, payload.emailId, scope, ['received'])
  if (claimed) return

  const startedAt = Date.now()
  while (Date.now() - startedAt < TAKEOVER_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS)

    // Forked and cleared every time: the row is written by another runner (and
    // usually another process), so a cached identity map would report the
    // email as `processing` forever.
    const em = (container.resolve('em') as EntityManager).fork({ clear: true })
    const email = (await em.findOne(InboxEmail, {
      id: payload.emailId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as never)) as { status?: string; processingError?: string | null } | null

    if (!email) {
      logger.warn('Email disappeared while waiting for the other extractor', {
        emailId: payload.emailId,
      })
      return
    }

    const decision = decideTakeover({
      status: email.status ?? 'received',
      processingError: email.processingError,
    })
    if (decision.action === 'wait') continue
    if (decision.action === 'skip') {
      logger.info('Leaving this email alone', { emailId: payload.emailId, reason: decision.reason })
      return
    }

    logger.info("Taking the email over after another extraction failed", {
      emailId: payload.emailId,
      otherError: email.processingError,
    })
    await tryExtract(container, payload.emailId, scope, ['failed'])
    return
  }

  logger.warn('Gave up waiting for the other extraction to finish', {
    emailId: payload.emailId,
    waitedMs: Date.now() - startedAt,
  })
}

/**
 * Runs the extraction if the claim succeeds.
 *
 * Returns false when another runner holds the email. Never throws on a model
 * failure: `runFreightExtraction` writes the reason onto the email and returns
 * it, and an exception here would only make the queue retry a call that will
 * fail again for the same reason.
 */
async function tryExtract(
  container: AwilixContainer,
  emailId: string,
  scope: { tenantId: string; organizationId: string },
  claimFrom: readonly string[],
): Promise<boolean> {
  let outcome
  try {
    outcome = await runFreightExtraction(container, { emailId, scope, claimFrom })
  } catch (err) {
    // The only throw on this path is a lost claim, which is an expected race,
    // not an error. Anything else is reported and swallowed for the reason
    // above.
    logger.info('Did not extract this email', {
      emailId,
      claimFrom: [...claimFrom],
      reason: err instanceof Error ? err.message : String(err),
    })
    return false
  }

  logger.info('Extraction finished', {
    emailId,
    emailStatus: outcome.emailStatus,
    proposalId: outcome.proposalId,
    actionCount: outcome.actions.length,
    model: outcome.llmModel,
    processingError: outcome.processingError,
  })

  if (outcome.proposalId) await recordInboxMessage(container, emailId, scope)

  return true
}

/**
 * Puts the email in the Messages inbox, the way core's worker does.
 *
 * WHY IT IS HERE AT ALL. `createMessageRecordForEmail` is called by core's
 * extraction worker (`inbox_ops/subscribers/extractionWorker.ts`, step 8c), and
 * this app disables that worker (`apps/mercato/src/modules.ts`). Without this
 * call the flow writes `inbox_emails` and `inbox_proposals` rows and the
 * Messages screen stays empty, so the operator sees the proposal but not the
 * enquiry it came from.
 *
 * WHERE IN THE LIFECYCLE. Core calls it after the email status is flushed and
 * before it emits its events. `runFreightExtraction` flushes the status and
 * emits `inbox_ops.proposal.created` in one go and is not ours to split, so
 * this is the first point after the flush that this module owns. The one
 * ordering difference from core is that the proposal event has already gone out
 * by the time the message row is written.
 *
 * ONLY ON A PROPOSAL, also like core: a run that ended on `failed` takes core's
 * catch path, which writes no message record.
 *
 * NEVER FATAL. The helper swallows its own errors and returns null, and this
 * catch keeps that property at the call site: a missing courtesy copy in the
 * inbox is not worth losing a proposal that already exists in the database.
 */
async function recordInboxMessage(
  container: AwilixContainer,
  emailId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<void> {
  try {
    // Forked and cleared for the same reason as the takeover loop above: the
    // row was just rewritten by another fork, and a stale identity map would
    // hand the helper the pre-extraction status.
    const em = (container.resolve('em') as EntityManager).fork({ clear: true })
    const email = (await em.findOne(InboxEmail, {
      id: emailId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    } as never)) as {
      id: string
      subject?: string | null
      cleanedText?: string | null
      rawText?: string | null
      forwardedByAddress: string
      forwardedByName?: string | null
      status: string
    } | null
    if (!email) return

    const messageId = await createMessageRecordForEmail(
      {
        id: email.id,
        subject: email.subject ?? '',
        cleanedText: email.cleanedText,
        rawText: email.rawText,
        forwardedByAddress: email.forwardedByAddress,
        forwardedByName: email.forwardedByName,
        status: email.status,
      },
      {
        container,
        scope: {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          userId: SYSTEM_USER_ID,
        },
      },
    )

    logger.info('Message record for the enquiry', { emailId, messageId })
  } catch (err) {
    logger.error('Messages integration failed (non-fatal)', { emailId, err })
  }
}
