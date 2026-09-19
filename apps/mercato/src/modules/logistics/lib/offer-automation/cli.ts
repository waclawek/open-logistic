import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
// Knowing exception, dev CLI only: this reaches straight into the installed
// `inbox_ops` and `sales` entities so the command can READ BACK what core and
// the subscribers wrote. It is NOT a cross-module ORM relation — no `logistics`
// entity declares a foreign key against either module, and every write on this
// path goes through core's webhook, core's execution engine or core's commands.
import {
  InboxEmail,
  InboxProposal,
  InboxProposalAction,
} from '@open-mercato/core/modules/inbox_ops/data/entities'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { emitInboxOpsEvent } from '@open-mercato/core/modules/inbox_ops/events'
import { DRAFT_OFFER_ACTION_TYPE, DRAFT_OFFER_REQUIRED_FEATURE } from '../../inbox-actions'
import { prepareOfferAutomation, resolveActorUserId } from './prepare'
import { FREIGHT_CURRENCY, FREIGHT_SERVICES } from './freightCatalog'
import {
  AUTOMATION_USER_EMAIL,
  resolveAutomationUserId,
} from './automationUser'
import {
  findInboxForScope,
  isInboxAddressActive,
  OFFER_INBOX_ADDRESS,
} from './offerInbox'
import { buildEnquiryEmail } from './inboundEnquiry'
import {
  decideWebhookOutcome,
  describeWebhookOutcome,
  INBOUND_WEBHOOK_PATH,
  postInboundWebhook,
  signWebhookRequest,
  WEBHOOK_SECRET_ENV,
  webhookContentHash,
  type InboundWebhookPayload,
} from './inboxWebhook'
import {
  deriveSenderIdentity,
  MAX_BODY_CHARS,
  previewBody,
  resolveEmailOverrides,
  type EmailOverrides,
} from './customEmailInput'
import { POLL_INTERVAL_MS, sleep } from './poll'
import {
  describeUnsettled,
  watchSettled,
  type WatchState,
} from './sendEmailWatch'
import {
  describeAiProvider,
  probeAiProvider,
  probeCoreExtractionSchema,
  type AiProviderDescription,
} from './aiProviderCheck'

/**
 * The three operator commands of the email-to-priced-quote flow.
 *
 * Rewritten from the source module's 2325-line `cli.ts`, which carried a whole
 * demo-company seeder, an offline stubbed demo path and an origins report. None
 * of that is ported. What is left is the chain an operator actually runs:
 *
 *   offers-prepare      make this organization ready (idempotent)
 *   offers-check-ai     will a model answer? (optional, costs one API call)
 *   offers-send-email   deliver one signed inbound email and watch what reacts
 *
 * Nothing here executes an inbox action or creates a quote. A human accepts the
 * proposed action in the inbox UI this repo already ships, which is the point of
 * the flow: the quote appears because a person said yes, priced by code.
 */

type Args = Record<string, string | boolean>

function parseArgs(rest: string[]): Args {
  const args: Args = {}
  for (let index = 0; index < rest.length; index += 1) {
    const part = rest[index]
    if (!part || !part.startsWith('--')) continue
    const [rawKey, inlineValue] = part.slice(2).split('=', 2)
    const key = rawKey ?? ''
    if (!key) continue
    if (inlineValue !== undefined) args[key] = inlineValue
    else if (rest[index + 1] && !rest[index + 1]!.startsWith('--')) args[key] = rest[++index]!
    else args[key] = true
  }
  return args
}

function readFlag(args: Args, ...names: string[]): string | null {
  for (const name of names) {
    const value = args[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function readBoolean(args: Args, ...names: string[]): boolean {
  return names.some((name) => args[name] === true || args[name] === 'true')
}

function fail(message: string, ...details: string[]): never {
  console.error(`\n${message}`)
  for (const line of details) console.error(line)
  console.error('')
  process.exit(1)
}

function baseUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
}

/**
 * Resolves the scope both writing commands run under.
 *
 * Both flags are required together and the organization is checked against the
 * tenant that owns it. There is no convenience fallback: the source module
 * could guess because it had seeded a uniquely-slugged demo organization, and
 * this port deliberately has not.
 */
async function resolveScope(
  em: EntityManager,
  args: Args,
  usage: string,
): Promise<{ tenantId: string; organizationId: string }> {
  const tenantId = readFlag(args, 'tenant', 'tenantId')
  const organizationId = readFlag(args, 'org', 'organizationId')
  if (!tenantId || !organizationId) {
    fail('--tenant and --org are both required.', usage)
  }
  const organization = await em.findOne(Organization, {
    id: organizationId,
    deletedAt: null,
  } as never)
  if (!organization) fail(`Organization ${organizationId} not found (or soft-deleted).`)
  const ownerTenantId = (organization as unknown as { tenant?: { id?: string } }).tenant?.id
  if (ownerTenantId !== tenantId) {
    fail(
      `Organization ${organizationId} belongs to tenant ${ownerTenantId ?? '<unknown>'}, not ${tenantId}. Refusing to work across tenants.`,
    )
  }
  return { tenantId: tenantId!, organizationId: organizationId! }
}

const PREPARE_USAGE = [
  'Usage:',
  '  yarn mercato logistics offers-prepare --tenant <tenantId> --org <organizationId>',
  '',
  'Makes one organization ready for the email-to-quote flow. Idempotent: run it',
  'as often as you like; a second run creates nothing.',
  '',
  'It creates exactly three things, because everything else this flow needs is',
  'already seeded by `mercato init` and the core module seeds:',
  `  1. ${FREIGHT_SERVICES.length} freight services in the catalogue, each with a ${FREIGHT_CURRENCY} list price,`,
  `  2. the inbox address ${OFFER_INBOX_ADDRESS}, which is what picks the tenant`,
  '     inside core\'s inbound webhook,',
  `  3. the automation account ${AUTOMATION_USER_EMAIL}, holding exactly one`,
  `     ACL feature (${DRAFT_OFFER_REQUIRED_FEATURE}) and no role.`,
  '',
  'Anything else missing is REPORTED, not created. Seeding a sales channel or',
  'writing a .env value is not this command\'s decision to make.',
  '',
  'Flags:',
  '  --tenant <uuid>   Required. Never inferred.',
  '  --org <uuid>      Required. Must belong to --tenant.',
  '  --user <uuid>     Acting user recorded on every seeded record. Defaults to',
  '                    the oldest user in the tenant.',
].join('\n')

const prepare: ModuleCli = {
  command: 'offers-prepare',
  async run(rest) {
    const args = parseArgs(rest)
    if (readBoolean(args, 'help', 'h')) {
      console.log(PREPARE_USAGE)
      return
    }

    const container = (await createRequestContainer()) as unknown as AwilixContainer
    try {
      const em = (container.resolve('em') as EntityManager).fork()
      const scope = await resolveScope(em, args, PREPARE_USAGE)

      const actorUserId =
        readFlag(args, 'user', 'userId') ?? (await resolveActorUserId(em, scope.tenantId))
      if (!actorUserId) {
        fail(
          `No user exists in tenant ${scope.tenantId}, so there is nobody to record as the actor.`,
          'Initialise the tenant first:  yarn mercato init',
        )
      }

      const result = await prepareOfferAutomation(container, {
        ...scope,
        actorUserId: actorUserId!,
      })

      console.log('')
      console.log(`Freight catalogue (${result.catalog.createdCount} row(s) created this run):`)
      for (const row of result.catalog.rows) {
        const created = [
          row.created.product ? 'product' : null,
          row.created.variant ? 'variant' : null,
          row.created.price ? 'price' : null,
        ].filter(Boolean)
        console.log(
          `  ${row.sku.padEnd(18)} ${row.unitPriceNet} ${FREIGHT_CURRENCY}  ${row.title}` +
            (created.length ? `  [created ${created.join(', ')}]` : '  [already present]'),
        )
      }
      console.log('')
      console.log('Inbox address:')
      console.log(`  ${result.inbox.inboxAddress}  (${result.inbox.state})`)
      if (result.inbox.previousAddress) {
        console.log(`  renamed from ${result.inbox.previousAddress}`)
      }
      console.log('')
      console.log('Automation identity:')
      console.log(`  ${result.automationUser.email}  (${result.automationUser.userId})`)
      console.log(`  features: ${result.automationUser.features.join(', ')}`)
      console.log(`  scoped to organization ${scope.organizationId} only, no role, no super-admin`)

      if (result.warnings.length > 0) {
        console.log('')
        console.log('Still missing, and not this command\'s to create:')
        for (const warning of result.warnings) {
          console.log(`  - ${warning.what}`)
          console.log(`    ${warning.fix}`)
        }
      }

      console.log('')
      console.log('Grant the draft feature to the roles that should accept these actions:')
      console.log(`  yarn mercato auth sync-role-acls --tenant ${scope.tenantId}`)
      console.log('')
      console.log('Then send the enquiry:')
      console.log(
        `  yarn mercato logistics offers-send-email --tenant ${scope.tenantId} --org ${scope.organizationId}`,
      )
      console.log('')
    } finally {
      await (container as unknown as { dispose: () => Promise<void> }).dispose()
    }
  },
}

const CHECK_AI_USAGE = [
  'Usage:',
  '  yarn mercato logistics offers-check-ai',
  '  yarn mercato logistics offers-check-ai --no-call',
  '',
  'Answers one question: will the extraction subscriber reach a model? Reports',
  'the provider, the model and whether the API key env var is set, then makes one',
  'small real call through the same code path core\'s extraction uses.',
  '',
  'No key, token or secret is ever printed. Presence only, and provider error',
  'messages are scrubbed before they are shown.',
  '',
  'Flags:',
  '  --no-call       Report the configuration and stop. Costs nothing, but proves',
  '                  only that the settings exist.',
  '  --timeout <ms>  How long the call may take. Default 30000.',
].join('\n')

function printAiConfiguration(description: AiProviderDescription): void {
  console.log('Model configuration:')
  console.log(`  provider:      ${description.providerId} (${description.providerName})`)
  console.log(`  model:         ${description.modelWithProvider ?? '<could not resolve>'}`)
  console.log(`  api key env:   ${description.apiKeyEnvVar}`)
  console.log(`  api key set:   ${description.apiKeyPresent ? 'yes' : 'NO'}`)
  if (description.configurationError) {
    console.log(`  error:         ${description.configurationError}`)
  }
}

/**
 * The pre-flight an operator runs before demoing.
 *
 * Exists because the failure it catches is the one that ruins a demo: a key
 * that is missing, expired or out of quota looks exactly like a working setup
 * until the model is called. Thirty seconds here beats finding out on stage.
 */
const checkAi: ModuleCli = {
  command: 'offers-check-ai',
  async run(rest) {
    const args = parseArgs(rest)
    if (readBoolean(args, 'help', 'h')) {
      console.log(CHECK_AI_USAGE)
      return
    }

    const skipCall = readBoolean(args, 'no-call', 'noCall', 'offline')
    const timeoutMs = Number(readFlag(args, 'timeout') ?? '30000')
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) {
      fail('--timeout must be an integer of at least 1000 (milliseconds).', CHECK_AI_USAGE)
    }

    console.log('')
    const description = await describeAiProvider()
    printAiConfiguration(description)
    console.log('')

    if (skipCall) {
      console.log('No call made (--no-call). Re-run without the flag to test reachability.')
      console.log('')
      if (!description.apiKeyPresent || description.configurationError) {
        fail('The model path is NOT configured; extraction would fail.')
      }
      return
    }

    // Two questions, asked separately on purpose. "Is the model reachable?" and
    // "does this provider accept core's extraction schema?" can have different
    // answers, and an operator who cannot see which is which will go hunting
    // for a key problem that does not exist.
    console.log('1/2  Is the model reachable? (strict-safe schema, this module\'s own extraction)')
    const reach = await probeAiProvider(timeoutMs)
    if (reach.ok) {
      console.log(
        `     OK. ${reach.modelWithProvider}, ${reach.tokensUsed} tokens, ${(reach.elapsedMs / 1000).toFixed(1)}s`,
      )
    } else {
      console.log(`     FAILED (${reach.failure})`)
      console.log(`     provider said: ${reach.detail}`)
      console.log(`     fix:           ${reach.hint}`)
    }

    console.log('')
    console.log("2/2  Does this provider accept core's extraction schema?")
    const routeA = await probeCoreExtractionSchema(timeoutMs)
    if (routeA.ok) {
      console.log(
        `     OK. ${routeA.modelWithProvider}, ${routeA.tokensUsed} tokens, ${(routeA.elapsedMs / 1000).toFixed(1)}s`,
      )
    } else {
      console.log(`     FAILED (${routeA.failure})`)
      console.log(`     provider said: ${routeA.detail}`)
      console.log(`     fix:           ${routeA.hint}`)
    }

    console.log('')
    if (!reach.ok) {
      console.log('The freight extraction cannot run. Fix the model configuration first.')
      console.log('')
      fail(`Model is NOT reachable (${reach.failure}).`)
    }
    console.log('Question 1 is the one this flow depends on. Question 2 only describes core\'s')
    console.log("own extraction worker, which this app disables (see apps/mercato/src/modules.ts).")
    console.log('')
  },
}

const SEND_EMAIL_USAGE = [
  'Usage:',
  '  yarn mercato logistics offers-send-email --tenant <tenantId> --org <organizationId>',
  '  yarn mercato logistics offers-send-email --tenant <t> --org <o> --from dispatch@acme-freight.example',
  '  yarn mercato logistics offers-send-email --tenant <t> --org <o> --subject "Quote please" --body "3 pallets Poznan to Hamburg, no dock."',
  '  yarn mercato logistics offers-send-email --tenant <t> --org <o> --body-file ./enquiry.txt',
  '',
  'Delivers ONE inbound customer email and stops. It signs a JSON payload and',
  `POSTs it to ${INBOUND_WEBHOOK_PATH} — the same endpoint a real`,
  'mail provider calls. CORE does the rest: it parses the email, deduplicates it,',
  'writes the `inbox_emails` row and emits the persistent',
  '`inbox_ops.email.received` event. This command creates no proposal, executes',
  'no action and takes no --user.',
  '',
  'It needs two things:',
  `  - a running server at \${APP_URL} (default http://localhost:3000), and`,
  `  - ${WEBHOOK_SECRET_ENV} set in .env, which is the HMAC key it signs with.`,
  '    The SERVER reads the same variable, so add it once and restart `yarn dev`.',
  '',
  'The recipient address is the organization\'s configured inbox, written by',
  '`offers-prepare`. That address is what picks the tenant inside core: nothing in',
  'the payload can override it.',
  '',
  'What reacts, in order:',
  '  1. an events worker picks the job up (`yarn dev` spawns one automatically),',
  `  2. ${'logistics:offer-freight-extraction'} turns the email into a proposal`,
  `     carrying one pending ${DRAFT_OFFER_ACTION_TYPE} action,`,
  '  3. a HUMAN accepts that action at /backend/inbox-ops/proposals/<id>, which',
  '     prices every line from the catalogue and creates a draft sales quote.',
  '',
  'Flags:',
  '  --tenant <uuid>   Required. Never inferred.',
  '  --org <uuid>      Required. Must belong to --tenant.',
  '  --from <addr>     Sender. Defaults to a one-off address nobody in the CRM',
  '                    owns, so the quote carries a customer snapshot. Point it',
  '                    at a seeded CRM contact and the quote links to that',
  '                    customer record. `--customer-email` is accepted as an',
  '                    alias. The command says which of the two happened.',
  '  --customer-name <name>   Company the sender writes for.',
  '  --contact-name <name>    Person who signs the email.',
  '  --subject <text>  Subject line. Defaults to the built-in enquiry subject.',
  '  --body <text>     The WHOLE email body, written by you. It REPLACES the',
  '                    built-in enquiry rather than being added to it, so the',
  '                    extraction reads only your job. Ask for something the',
  '                    seeded services cannot cover and the action refuses with',
  '                    no quote, which is the fail-closed path. It also makes the',
  '                    email unique, which matters: core deduplicates on subject +',
  '                    sender + body, per organization, with no time window, so',
  '                    the built-in enquiry can only be delivered here once.',
  '  --body-file <path>  The same, read from a file, so a long multi-paragraph',
  '                    email does not have to survive shell quoting. Mutually',
  '                    exclusive with --body.',
  `                    Either way the body is capped at ${MAX_BODY_CHARS} characters,`,
  '                    because it is pasted whole into the extraction prompt.',
  '  --note <text>     One more sentence from the customer, appended to the body.',
  '                    Use it to demonstrate the refusal: --note "Please quote in',
  '                    USD." asks for a currency the catalogue has no price in, so',
  '                    accepting the action refuses and NO quote is created.',
  '  --no-watch        Deliver and exit. By default the command watches the rows',
  '                    the subscriber writes and prints them; the watch is',
  '                    READ-ONLY and changes nothing.',
  '  --watch-timeout <ms>  How long to watch. Default 60000.',
  '  --replay <inboxEmailId>  Re-emit `inbox_ops.email.received` for an email that',
  '                    already exists. Writes NOTHING. This is how the handoff is',
  '                    proven idempotent: a redelivered job must not produce a',
  '                    second proposal.',
].join('\n')

/**
 * Message-ID prefix for emails this command sends.
 *
 * It is also how the command finds the row afterwards. Core's webhook answers
 * `200 {"ok":true}` whether it stored the email or dropped it, and it assigns
 * the row id itself, so the message id we put in the payload is the only handle
 * we keep on the other side of the POST.
 */
const SENT_MESSAGE_ID_PREFIX = '<logistics-offers-send-'

/** How long to wait for the row core writes, after a 200. */
const WEBHOOK_ROW_TIMEOUT_MS = 5000

/**
 * Waits for the row core's webhook writes, found by the message id we sent.
 *
 * Forked and cleared on every read because the row is written by ANOTHER
 * process (the dev server), so a cached identity map would keep reporting the
 * first miss. `message_id` is one of the columns core deliberately leaves
 * unencrypted, so it can be used in a WHERE clause.
 */
async function awaitStoredEmail(
  container: AwilixContainer,
  messageId: string,
  scope: { tenantId: string; organizationId: string },
  timeoutMs: number,
): Promise<string | null> {
  const startedAt = Date.now()
  for (;;) {
    const em = (container.resolve('em') as EntityManager).fork({ clear: true })
    const row = (await em.findOne(InboxEmail, {
      messageId,
      ...scope,
      deletedAt: null,
    } as never)) as { id: string } | null
    if (row) return row.id
    if (Date.now() - startedAt >= timeoutMs) return null
    await sleep(POLL_INTERVAL_MS)
  }
}

/**
 * The email core already held under this content hash, if any.
 *
 * `content_hash` is unencrypted for exactly this reason: it is core's own
 * deduplication key, matched per tenant and organization with no time window.
 */
async function findEmailIdByContentHash(
  em: EntityManager,
  contentHash: string,
  scope: { tenantId: string; organizationId: string },
): Promise<string | null> {
  const row = (await em.findOne(InboxEmail, {
    contentHash,
    ...scope,
    deletedAt: null,
  } as never)) as { id: string } | null
  return row?.id ?? null
}

/**
 * Whether this address already belongs to a CRM customer.
 *
 * Read-only and optional: the quote is created either way, with a link when a
 * customer owns the address and a snapshot when nobody does. Asked before the
 * POST so the answer can be printed next to the sender, which is the only place
 * an operator will connect the two.
 */
async function previewCrmLink(
  container: AwilixContainer,
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  email: string,
): Promise<string | null> {
  try {
    const CustomerEntityClass = container.resolve('CustomerEntity') as never
    const found = (await findOneWithDecryption(
      em,
      CustomerEntityClass,
      {
        primaryEmail: email.toLowerCase(),
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      } as never,
      undefined,
      scope,
    )) as { id?: string } | null
    return found?.id ?? null
  } catch {
    // The customers module is optional. No link is a supported outcome, so a
    // resolver miss is not worth failing a delivery over.
    return null
  }
}

/**
 * Reads what the subscriber has written so far. Writes nothing, ever.
 *
 * Forks and clears on every call because the rows are produced by ANOTHER
 * process (the events worker), so a cached identity map would keep reporting
 * the first state it saw.
 */
async function readWatchState(
  container: AwilixContainer,
  emailId: string,
  scope: { tenantId: string; organizationId: string },
): Promise<WatchState> {
  const em = (container.resolve('em') as EntityManager).fork({ clear: true })

  const email = (await em.findOne(InboxEmail, { id: emailId } as never)) as {
    status?: string
    processingError?: string | null
  } | null

  const proposal = (await em.findOne(
    InboxProposal,
    { inboxEmailId: emailId, isActive: true, ...scope } as never,
    { orderBy: { createdAt: 'DESC' } } as never,
  )) as { id: string } | null

  const action = proposal
    ? ((await em.findOne(
        InboxProposalAction,
        { proposalId: proposal.id, actionType: DRAFT_OFFER_ACTION_TYPE } as never,
        { orderBy: { sortOrder: 'ASC' } } as never,
      )) as {
        id: string
        status?: string
        executionError?: string | null
        createdEntityId?: string | null
        executedByUserId?: string | null
      } | null)
    : null

  const quoteId = action?.createdEntityId ?? null
  const quote = quoteId
    ? ((await em.findOne(SalesQuote, { id: quoteId } as never)) as {
        quoteNumber?: string
        grandTotalNetAmount?: string
        currencyCode?: string
        customerEntityId?: string | null
      } | null)
    : null

  return {
    proposalId: proposal?.id ?? null,
    actionId: action?.id ?? null,
    actionStatus: action?.status ?? null,
    executionError: action?.executionError ?? null,
    emailStatus: email?.status ?? '<email missing>',
    processingError: email?.processingError ?? null,
    quoteId,
    quoteNumber: quote?.quoteNumber ?? null,
    quoteTotal: quote?.grandTotalNetAmount ?? null,
    quoteCurrency: quote?.currencyCode ?? null,
    customerEntityId: quote?.customerEntityId ?? null,
    executedByUserId: action?.executedByUserId ?? null,
    notificationCount: 0,
  }
}

/**
 * Re-delivers `inbox_ops.email.received` for an email that already exists.
 *
 * Reads the row first so the payload is the real one rather than something
 * retyped by hand: a replay that carried a different payload would prove
 * nothing about the handler's idempotency.
 */
async function replayEmailEvent(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  replayEmailId: string,
): Promise<void> {
  const email = (await em.findOne(InboxEmail, {
    id: replayEmailId,
    ...scope,
  } as never)) as {
    id: string
    subject?: string | null
    forwardedByAddress: string
    status?: string
  } | null
  if (!email) fail(`Inbox email ${replayEmailId} not found in this scope.`)

  await emitInboxOpsEvent(
    'inbox_ops.email.received',
    {
      emailId: email!.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      forwardedByAddress: email!.forwardedByAddress,
      subject: email!.subject ?? '',
    },
    { persistent: true, ...scope },
  )
  console.log('')
  console.log('Re-emitted inbox_ops.email.received for an email that already exists.')
  console.log(`  inboxEmailId:    ${email!.id}`)
  console.log(`  emailStatus:     ${email!.status ?? '<unknown>'}`)
  console.log('Nothing was written by this command. The extractor claims the email with one')
  console.log('conditional UPDATE, so an email that is no longer `received` is left alone:')
  console.log('expect no new proposal.')
  console.log('')
}

/**
 * One command that starts the whole chain and then gets out of the way.
 *
 * It deliberately does NOT execute the action, create the quote or take a
 * `--user`. If this command could do any of that, the demo would prove nothing:
 * the point is that the proposal appears because the system reacted to an
 * event, and that the quote appears because a person accepted it.
 */
const sendEmail: ModuleCli = {
  command: 'offers-send-email',
  async run(rest) {
    const args = parseArgs(rest)
    if (readBoolean(args, 'help', 'h')) {
      console.log(SEND_EMAIL_USAGE)
      return
    }

    const replayEmailId = readFlag(args, 'replay', 'replay-email', 'replayEmail')
    const watch = !readBoolean(args, 'no-watch', 'noWatch')
    const watchTimeoutMs = Number(readFlag(args, 'watch-timeout', 'watchTimeout') ?? '60000')
    if (!Number.isInteger(watchTimeoutMs) || watchTimeoutMs < 1000) {
      fail('--watch-timeout must be an integer of at least 1000 (milliseconds).', SEND_EMAIL_USAGE)
    }

    // Everything the operator typed is checked before the container is even
    // built. A bad path or an empty body must cost a re-typed command, not a
    // half-seeded chain: past this point an `inbox_emails` row exists and an
    // event is on the queue.
    const overrideResult = resolveEmailOverrides({
      body: args.body,
      bodyFile: args['body-file'] ?? args.bodyFile,
      subject: args.subject,
      from: args.from ?? args['customer-email'] ?? args.customerEmail,
    })
    if (!overrideResult.ok) {
      fail(
        overrideResult.message,
        ...overrideResult.hints,
        '',
        'Nothing was written. Full flag list: offers-send-email --help',
      )
    }
    const overrides: EmailOverrides = overrideResult.overrides

    const container = (await createRequestContainer()) as unknown as AwilixContainer
    try {
      const em = (container.resolve('em') as EntityManager).fork()
      const scope = await resolveScope(em, args, SEND_EMAIL_USAGE)
      const { tenantId, organizationId } = scope

      if (replayEmailId) {
        await replayEmailEvent(em, scope, replayEmailId)
        return
      }

      // Preflights, before anything leaves this process. Each failure is one
      // line to fix and painful to diagnose afterwards: one comes back as a 503
      // from the server, the other as a 200 that stored nothing.
      const webhookSecret = process.env[WEBHOOK_SECRET_ENV]?.trim()
      if (!webhookSecret) {
        fail(
          `${WEBHOOK_SECRET_ENV} is not set, so this command cannot sign the webhook and the server would answer 503.`,
          'Add one line to .env. Any long random string will do, and the value is',
          'never printed by this command:',
          `  ${WEBHOOK_SECRET_ENV}=<a long random string>`,
          'The SERVER reads the same variable, so restart `yarn dev` after adding it.',
          'Nothing was written.',
        )
      }

      // The address decides the tenant. Core's webhook resolves the recipient to
      // one `inbox_settings` row and takes the tenant and organization off THAT
      // row, ignoring anything else in the payload. So the address is read from
      // the scope this command already validated, never hardcoded: sending to a
      // fixed address would deliver into whichever organization owns it.
      const inbox = await findInboxForScope(em.fork(), scope)
      if (!inbox || !inbox.isActive) {
        fail(
          `No active inbox address is configured for organization ${organizationId}; core's webhook would answer 200 and drop the email.`,
          'The recipient address is what picks the tenant, so it is not optional.',
          'Write it (idempotent, creates nothing else that already exists):',
          `  yarn mercato logistics offers-prepare --tenant ${tenantId} --org ${organizationId}`,
          'Nothing was written.',
        )
      }
      const toAddress = inbox!.inboxAddress

      const customerEmail = overrides.from ?? 'dispatch@acme-freight.example'
      const derived = deriveSenderIdentity(customerEmail)
      const customerName = readFlag(args, 'customer-name', 'customerName') ?? derived.customerName
      const contactName = readFlag(args, 'contact-name', 'contactName') ?? derived.contactName

      // `emailId` is this module's proposal only. Core's webhook assigns the row
      // id itself, so the id that ends up in `inbox_emails` is read back below.
      const seededEmail = buildEnquiryEmail({
        emailId: randomUUID(),
        messageIdPrefix: SENT_MESSAGE_ID_PREFIX,
        customerEmail,
        customerName,
        contactName,
        tenantId,
        organizationId,
        toAddress,
        status: 'received',
        seededBy: 'logistics offers-send-email',
        extraNote: readFlag(args, 'note'),
        body: overrides.body,
        subject: overrides.subject,
        now: new Date(),
      })

      const crmCustomerId = await previewCrmLink(container, em.fork(), scope, customerEmail)

      // The handoff. This is a real HTTP call to the endpoint a mail provider
      // would call, signed with the same HMAC scheme core verifies. Everything
      // after it — parsing, deduplication, the `inbox_emails` row and the
      // persistent `inbox_ops.email.received` event — is core's own code, which
      // is the point: nothing here fakes a step of the inbound path.
      const payload: InboundWebhookPayload = {
        from: `${customerName} <${customerEmail}>`,
        to: toAddress,
        subject: seededEmail.subject,
        text: seededEmail.rawText,
        messageId: seededEmail.messageId,
        replyTo: seededEmail.replyTo,
      }
      const webhookUrl = `${baseUrl()}${INBOUND_WEBHOOK_PATH}`
      const posted = await postInboundWebhook({
        url: webhookUrl,
        signed: signWebhookRequest({ payload, secret: webhookSecret!, now: new Date() }),
      })

      if (!posted.ok && posted.kind === 'unreachable') {
        fail(
          `Could not reach ${webhookUrl}: ${posted.detail}`,
          'Nothing was written, in any tenant.',
          `This command delivers over HTTP, so the app has to be running at ${baseUrl()}`,
          '(set APP_URL to point somewhere else). Start it with:',
          '  yarn dev',
        )
      }
      if (!posted.ok) {
        fail(
          `The inbound webhook refused the request: HTTP ${posted.status}.`,
          `  response body: ${posted.body || '<empty>'}`,
          'Nothing was written, in any tenant.',
          posted.status === 503
            ? `503 means the SERVER has no ${WEBHOOK_SECRET_ENV}. Add it to .env and restart \`yarn dev\`.`
            : posted.status === 400
              ? 'A 400 here is a signature or timestamp rejection. Check that this machine'
                + " and the server agree on the time to within five minutes, and that both read the same .env."
              : 'See the dev-server log for the inbox_ops webhook.',
        )
      }

      // Core answers `200 {"ok":true}` for a stored email, for an unknown
      // recipient AND for a duplicate, so the 200 above proves nothing. The row
      // is read back by the message id we sent, which is the only handle that
      // survives the POST.
      const storedInboxEmailId = await awaitStoredEmail(
        container,
        seededEmail.messageId,
        scope,
        WEBHOOK_ROW_TIMEOUT_MS,
      )
      if (!storedInboxEmailId) {
        const probeEm = (container.resolve('em') as EntityManager).fork({ clear: true })
        const outcome = decideWebhookOutcome({
          storedInboxEmailId: null,
          duplicateInboxEmailId: await findEmailIdByContentHash(
            probeEm,
            webhookContentHash(payload),
            scope,
          ),
          inboxSettingsPresent: await isInboxAddressActive(probeEm, toAddress),
        })
        console.error('')
        console.error('THE WEBHOOK ANSWERED 200 AND NO EMAIL WAS STORED.')
        for (const line of describeWebhookOutcome(outcome, {
          toAddress,
          tenantId,
          organizationId,
          messageId: seededEmail.messageId,
        })) {
          console.error(line)
        }
        fail(`No inbox email was stored for ${toAddress} (outcome: ${outcome.kind}).`)
      }

      const bodyLines = previewBody(seededEmail.rawText)

      console.log('')
      console.log("Inbound email delivered to core's webhook, parsed and stored.")
      console.log('')
      console.log('This is what was sent:')
      console.log(`  from:            ${customerEmail} (${customerName})`)
      console.log(`  to:              ${toAddress}`)
      console.log(`  subject:         ${seededEmail.subject}`)
      console.log(`  body:            ${bodyLines[0] ?? ''}`)
      for (const line of bodyLines.slice(1)) console.log(`                   ${line}`)
      console.log(
        `  body source:     ${
          overrides.bodySource === 'built-in'
            ? 'built-in enquiry (no --body / --body-file given)'
            : overrides.bodyPath
              ? `${overrides.bodySource} ${overrides.bodyPath}`
              : overrides.bodySource
        }`,
      )
      console.log(
        crmCustomerId
          ? `  CRM customer:    ${crmCustomerId} (the quote will link to this record)`
          : '  CRM customer:    none, so the quote will carry a snapshot, not a link',
      )
      console.log('')
      console.log('Rows written:')
      console.log(`  tenantId:        ${tenantId}`)
      console.log(`  organizationId:  ${organizationId}`)
      console.log(
        `  inboxEmailId:    ${storedInboxEmailId}  (written by core, not by this command)`,
      )
      console.log(`  webhook:         POST ${webhookUrl} -> ${posted.status}`)
      console.log('  event:           inbox_ops.email.received (persistent, emitted by core)')
      console.log('')
      console.log('Where to read it:')
      console.log(`  Proposals: ${baseUrl()}/backend/inbox-ops`)
      console.log(`  Quotes:    ${baseUrl()}/backend/sales/quotes`)

      if (!watch) {
        console.log('')
        console.log('Not watching (--no-watch). Nothing else runs in this process.')
        console.log('')
        return
      }

      console.log('')
      console.log(
        `Watching the rows the subscriber writes (read-only, up to ${Math.round(watchTimeoutMs / 1000)}s)...`,
      )

      const startedAt = Date.now()
      let state = await readWatchState(container, storedInboxEmailId!, scope)
      while (!watchSettled(state) && Date.now() - startedAt < watchTimeoutMs) {
        await sleep(POLL_INTERVAL_MS)
        state = await readWatchState(container, storedInboxEmailId!, scope)
      }
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)

      console.log('')
      console.log(`After ${elapsed}s:`)
      console.log(`  emailStatus:     ${state.emailStatus}`)
      if (state.processingError) console.log(`  emailError:      ${state.processingError}`)
      console.log(`  proposalId:      ${state.proposalId ?? '<none yet>'}`)
      console.log(`  actionId:        ${state.actionId ?? '<none yet>'}`)
      console.log(`  actionStatus:    ${state.actionStatus ?? '<none yet>'}`)
      if (state.executionError) console.log(`  actionError:     ${state.executionError}`)

      if (state.proposalId) {
        console.log('')
        console.log('A human accepts the action here, and THAT is what creates the quote:')
        console.log(`  ${baseUrl()}/backend/inbox-ops/proposals/${state.proposalId}`)
        console.log('')
        return
      }

      console.log('')
      if (state.emailStatus === 'failed') {
        console.log('Extraction refused this email, so no action exists. The reason is on')
        console.log('emailError above; the usual one is that the model judged it not to be a')
        console.log('freight enquiry, or that no seeded service fits what was asked for.')
        console.log('')
        return
      }

      if (describeUnsettled(state) === 'nothing-reacted') {
        console.log('Nothing has touched this email. The job is durable and still queued, so the')
        console.log('cause is almost always that no events worker is draining the queue.')
        console.log('Start one with:')
        console.log('  yarn mercato queue worker --all')
        console.log('(`yarn dev` spawns one itself when AUTO_SPAWN_WORKERS is on.)')
      } else {
        console.log('Something is working on it and the watch window closed first. Give it longer')
        console.log('with --watch-timeout, or check the queue worker log for an error.')
      }
      console.log('')
    } finally {
      await (container as unknown as { dispose: () => Promise<void> }).dispose()
    }
  },
}

export const offerAutomationCli: ModuleCli[] = [prepare, checkAi, sendEmail]

export default offerAutomationCli
