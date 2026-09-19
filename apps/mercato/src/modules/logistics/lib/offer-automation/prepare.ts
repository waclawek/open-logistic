import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
// Knowing exception, read-only preflight: the installed `sales` and `auth`
// entities are READ so this command can say what is missing instead of failing
// halfway through a chain. Every write on this path goes through core commands
// (`catalog.*`, `auth.users.create`, `auth.user-acl.update`) or, for
// `inbox_settings`, through the helper that documents why core has no command.
import { SalesChannel } from '@open-mercato/core/modules/sales/data/entities'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { seedFreightServices, type FreightCatalogSeedResult } from './freightCatalog'
import { ensureOfferInbox, type OfferInbox } from './offerInbox'
import { ensureAutomationUser, type AutomationUser } from './automationUser'

/**
 * Everything `offers-send-email` needs to exist before it will do anything.
 *
 * WHY THIS COMMAND IS SMALL
 * -------------------------
 * The source module shipped a 635-line company seeder that built a tenant, an
 * organization, users, customers, a sales channel and a CRM. None of that is
 * ported: this repo already seeds a tenant, an organization, users, customers
 * and a sales channel through `mercato init` and the core module seeds. Three
 * things genuinely do not exist here, and this command creates exactly those:
 *
 *   1. the four freight services the extraction prompt names, with a list price,
 *   2. an inbox address core's webhook can resolve to this organization,
 *   3. the scoped automation identity, holding one ACL feature and nothing else.
 *
 * Everything else is PREFLIGHTED, not created. A missing sales channel is
 * reported with the core command that seeds it, because inventing one here
 * would put a quote on a channel the business never configured.
 *
 * Idempotent at every level. Run it twice and it creates nothing the second
 * time; `created` counts say so.
 */

export type PrepareScope = {
  tenantId: string
  organizationId: string
  /** Acting user. Recorded as the operation-log actor for every command below. */
  actorUserId: string
}

export type PrepareWarning = {
  what: string
  fix: string
}

export type PrepareResult = {
  catalog: FreightCatalogSeedResult
  inbox: OfferInbox
  automationUser: AutomationUser
  /** Non-fatal gaps this command is not entitled to fill. */
  warnings: PrepareWarning[]
}

/**
 * The acting user for the writes, when the operator did not name one.
 *
 * Picks the oldest non-deleted user in the tenant, deterministically. This is
 * an actor for the operation log, not an authorisation decision: every command
 * below still runs with `isSuperAdmin: false` and is scoped to one
 * organization.
 */
export async function resolveActorUserId(
  em: EntityManager,
  tenantId: string,
): Promise<string | null> {
  const found = (await findOneWithDecryption(
    em,
    User,
    { tenantId, deletedAt: null } as never,
    { orderBy: { createdAt: 'ASC' } } as never,
    { tenantId, organizationId: null },
  )) as { id?: string } | null
  return found?.id ?? null
}

/**
 * Whether this organization has a sales channel a quote could be written onto.
 *
 * `createDraftOfferQuote` refuses without one, on purpose: a quote with no
 * channel is a document nobody owns. Reported here so the refusal is read on a
 * terminal before the demo rather than in a queue worker log during it.
 */
async function hasActiveSalesChannel(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<boolean> {
  const found = (await findOneWithDecryption(
    em,
    SalesChannel,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      isActive: true,
      deletedAt: null,
    } as never,
    undefined,
    scope,
  )) as { id?: string } | null
  return Boolean(found?.id)
}

export async function prepareOfferAutomation(
  container: AwilixContainer,
  scope: PrepareScope,
): Promise<PrepareResult> {
  const catalog = await seedFreightServices(container, scope)
  const inbox = await ensureOfferInbox(container, scope)
  const automationUser = await ensureAutomationUser(container, scope)

  const em = (container.resolve('em') as EntityManager).fork({ clear: true })
  const warnings: PrepareWarning[] = []

  if (!(await hasActiveSalesChannel(em, scope))) {
    warnings.push({
      what: 'This organization has no ACTIVE sales channel, so accepting a draft_offer would refuse.',
      fix: `yarn mercato sales seed-examples --tenant ${scope.tenantId} --org ${scope.organizationId}`,
    })
  }

  if (!process.env.INBOX_OPS_WEBHOOK_SECRET?.trim()) {
    warnings.push({
      what: 'INBOX_OPS_WEBHOOK_SECRET is not set, so offers-send-email cannot sign the webhook and the server would answer 503.',
      fix: 'Add INBOX_OPS_WEBHOOK_SECRET=<a long random string> to .env, then restart `yarn dev`.',
    })
  }

  return { catalog, inbox, automationUser, warnings }
}
