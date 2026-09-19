import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
// Knowing exception, dev prerequisite only: `inbox_settings` is an installed
// `inbox_ops` entity and core ships no create command for it (its settings API
// is GET + PATCH only), so the row has to be written the way core's own
// `onTenantCreated` hook writes it. Nothing here declares a relation against
// another module.
import { InboxSettings } from '@open-mercato/core/modules/inbox_ops/data/entities'

/**
 * The address the freight enquiry is sent TO.
 *
 * This is the value that picks a tenant. Core's webhook resolves the recipient
 * address to exactly one `inbox_settings` row and takes the tenant and the
 * organization off that row; nothing in the payload can override it.
 *
 * Rewritten from the source module's `demoInbox.ts`, which derived the address
 * from a seeded demo company this port deliberately leaves behind. The address
 * is a constant here instead, so `offers-prepare` needs no company seeder.
 *
 * `.example` is reserved by RFC 2606, so it can never reach a real inbox.
 */
export const OFFER_INBOX_ADDRESS = 'quotes@logistics.example'

export type OfferInboxState =
  /** No row existed for this organization; this run wrote one. */
  | 'created'
  /**
   * Core's `inbox_ops` tenant-setup hook had already written a row for this
   * organization under its own generated address; this run renamed it.
   */
  | 'adopted'
  /** The address was already configured here. Nothing changed. */
  | 'already present'

export type OfferInbox = {
  settingsId: string
  inboxAddress: string
  state: OfferInboxState
  /** The address core's setup hook generated, when this run replaced it. */
  previousAddress?: string
}

type InboxSettingsRow = {
  id: string
  inboxAddress: string
  isActive: boolean
  organizationId: string
  tenantId: string
  deletedAt?: Date | null
}

/**
 * The active inbox row for one organization, or null.
 *
 * Decrypted on read because `webhook_secret` is an encrypted column: a row
 * loaded raw still holds ciphertext in memory, and flushing it would re-encrypt
 * what is already encrypted. Core's own settings route loads it the same way.
 */
export async function findInboxForScope(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<InboxSettingsRow | null> {
  return (await findOneWithDecryption(
    em,
    InboxSettings,
    { organizationId: scope.organizationId, tenantId: scope.tenantId, deletedAt: null } as never,
    undefined,
    scope,
  )) as InboxSettingsRow | null
}

/** Whether an ACTIVE row still owns this address. The webhook's own lookup. */
export async function isInboxAddressActive(em: EntityManager, address: string): Promise<boolean> {
  const row = await em.findOne(InboxSettings, {
    inboxAddress: address.toLowerCase(),
    isActive: true,
    deletedAt: null,
  } as never)
  return row != null
}

/**
 * Makes `quotes@logistics.example` this organization's inbox address.
 *
 * Idempotent in the three shapes a real database turns up in:
 *
 *  1. The address is already configured here. Reactivated if somebody switched
 *     it off in the settings UI, otherwise untouched.
 *  2. This organization has a row under ANOTHER address. That is the normal
 *     case on a fresh install: core's `inbox_ops` setup hook runs inside
 *     `setupInitialTenant` and writes `ops-<org-prefix>@inbox.mercato.local`.
 *     That row is RENAMED rather than joined by a second one, because core's
 *     settings API resolves the inbox with one find-by-tenant+organization and
 *     a second row would make which one it returns a coin toss.
 *  3. Nothing exists. One row is created, the way core's hook creates it.
 *
 * `webhook_secret` is deliberately left null, so the global
 * `INBOX_OPS_WEBHOOK_SECRET` stays the accepted signing key for this inbox. A
 * per-tenant secret would have to be decrypted before the CLI could sign with
 * it, and this flow gains nothing from it.
 *
 * `inbox_address` is unique across the whole table, so an address already held
 * by a DIFFERENT organization is a refusal rather than a steal.
 */
export async function ensureOfferInbox(
  container: AwilixContainer,
  scope: { tenantId: string; organizationId: string },
): Promise<OfferInbox> {
  const em = (container.resolve('em') as EntityManager).fork()

  // No decryption scope on purpose, exactly as core's webhook looks this row
  // up: the helper falls back to the tenant on the row it found, which is what
  // keeps the lookup correct for a row that turns out to belong elsewhere.
  const byAddress = (await findOneWithDecryption(
    em,
    InboxSettings,
    { inboxAddress: OFFER_INBOX_ADDRESS, deletedAt: null } as never,
  )) as InboxSettingsRow | null

  if (byAddress) {
    if (byAddress.tenantId !== scope.tenantId || byAddress.organizationId !== scope.organizationId) {
      throw new Error(
        `${OFFER_INBOX_ADDRESS} is already configured for tenant ${byAddress.tenantId} / organization `
          + `${byAddress.organizationId}. Inbox addresses are unique across the whole install, so this `
          + 'command refuses to take it away from them.',
      )
    }
    if (!byAddress.isActive) {
      byAddress.isActive = true
      await em.flush()
    }
    return {
      settingsId: byAddress.id,
      inboxAddress: byAddress.inboxAddress,
      state: 'already present',
    }
  }

  const forScope = await findInboxForScope(em, scope)
  if (forScope) {
    const previousAddress = forScope.inboxAddress
    forScope.inboxAddress = OFFER_INBOX_ADDRESS
    forScope.isActive = true
    await em.flush()
    return {
      settingsId: forScope.id,
      inboxAddress: OFFER_INBOX_ADDRESS,
      state: 'adopted',
      previousAddress,
    }
  }

  const created = em.create(InboxSettings, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    inboxAddress: OFFER_INBOX_ADDRESS,
    isActive: true,
  })
  em.persist(created)
  await em.flush()
  return { settingsId: created.id, inboxAddress: OFFER_INBOX_ADDRESS, state: 'created' }
}
