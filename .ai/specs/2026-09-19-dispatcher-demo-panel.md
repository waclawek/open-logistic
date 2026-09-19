# Persistent dispatcher panel

Date: 2026-09-19. Status: persistence implemented and verified.

## Overview

The user requested database-backed offers, transports and decisions in PR #11,
exactly two sidebar entries (AI inbox / AI Przewozy), multiple additional orders
until capacity is exhausted, and an explicit rejected status. This revision supersedes the earlier session-only demonstration.

### Proposed solution and architecture

Keep the logistics module self-contained. Persist scoped offers and transports,
including customer cargo (Order 1), carrier/vehicle snapshot (Order 2), and
numbered additional loads (Order 3 onward). Sales accounting and integrations are
outside this revision. Demonstration records may be inserted by seedExamples;
the browser reads database records and never manufactures business records.
Refresh and navigation preserve all confirmed/rejected decisions.

Use the customers reference module's command, mutation-guard and tenant scoping
patterns. New entities have UUID ids, tenant_id, organization_id, created_at,
updated_at and deleted_at. Responses expose updatedAt for optimistic locking.
Create new logistics tables through an additive migration and matching snapshot.
Applying the migration to an existing developer database needs separate approval.

### API contracts and decisions

- GET /api/logistics/offers and /api/logistics/transports return paged items,
  total, page and totalPages; pageSize is at most 100; search is server-side.
- POST on each collection creates scoped records. DELETE ?id= removes fixture
  or operational records through the same command and optimistic-lock contract.
- POST /api/logistics/offers/[id]/decision accepts action=reject.
- POST /api/logistics/transports/[id]/decision accepts approve_carrier,
  reject_carrier or accept_load (with offerId).
- Decisions return the updated item. A stale version produces HTTP 409 and the
  shared client conflict UI; the client does not silently overwrite another user.
- Reads require logistics.view, writes logistics.manage. Every lookup, write and
  allocation is scoped to the authenticated tenant and selected organization.
- Offer statuses: new, review, accepted, rejected. Carrier/order statuses:
  pending, confirmed, rejected. Rejected offers cannot become additional loads;
  a rejected carrier cannot accept loads. Decisions on terminal states fail.
- Accepting a load locks and rechecks the transport and offer in one transaction.
  One offer cannot be allocated to multiple transports. Number accepted loads
  monotonically from Order 3; never reuse one fixed demo identifier.
- Remaining weight/pallets = vehicle capacity minus Order 1 minus every confirmed
  additional load. Both limits must fit; missing/unconfirmed/rejected carrier,
  invalid cargo or overload prevent acceptance. This models one shared leg.

### UI and compatibility

The existing /backend/logistics route opens AI inbox; the additive
/backend/logistics/transports route opens AI Przewozy. Only these two entries
appear in the Logistyka group. Legacy routes remain reachable by their URLs.
Keep table extension IDs stable. Use API loading, error and empty states, guarded
mutations and refreshed server responses. Offer details allow rejection; transport
details allow carrier approval/rejection and selection among available persisted
offers. Display the additional order numbers and their cargo. Remove session-reset
controls and all copy promising that decisions disappear after refresh.

### Migration & Backward Compatibility

All database tables, API routes and logistics.manage permission are additive.
Existing logistics.view, backend URLs and extension hosts remain stable. The
explicitly requested navigation reduction only hides legacy sidebar entries.
Deploy the new migration before serving these pages, synchronize role ACLs and
clear the structural navigation cache. Existing browser-only demo decisions have
no persisted source to migrate. Example seeding is optional and organization-scoped.
No Sales contracts, upstream modules or external providers change.

### Risks and validation plan

- High: concurrent allocations exceed capacity or allocate an offer twice.
  Mitigation: atomic locks, state recheck and optimistic version check; exercise
  concurrent/stale decisions in API tests.
- High: cross-organization data exposure. Mitigation: scoped reads and writes,
  including both records in accept_load; exercise foreign-organization ids.
- Medium: navigation or refresh loses changes. Mitigation: database round-trip
  browser scenario covering Order 3/4/5, rejection and reload.
- Medium: migration differs from entity metadata. Mitigation: generated/scoped
  migration, snapshot review and schema generation no-op verification.
- Integration tests create their own offers/transports and auth fixtures, clean
  them up, and do not depend on seedExamples. Cover all four API route families,
  unauthorized writes, paging, reject, capacity boundaries, and both UI routes.
- Record actual validation outcomes below when implementation is complete.

### Revision changelog

- 2026-09-19: Persistence, two sidebar destinations, repeated numbered additional
  loads and rejection requested; replaces the previously approved demo-only scope.

## Final compliance and validation record

Runner: local (no running Compose app container).

- Module Jest suite: 7 suites / 92 tests passed. Coverage includes navigation,
  persisted client interactions, capacity boundaries, atomic command ordering,
  tenant/organization scope, stale writes, child mutation guards, and late
  responses after organization/selection changes.
- App typecheck, package builds and full Next.js application build passed.
- Design-system lint for the logistics module passed using the repository's
  TypeScript compatibility hook.
- Hardcoded-string scan passed; all five locale dictionaries contain matching
  keys with no missing translations. Identical product/order labels are retained.
- Lessons catalog validation passed.
- Generator created a scoped two-table migration and snapshot; unrelated WMS
  generator drift was removed. The user approved applying this migration locally.
  It was applied successfully; subsequent scoped schema generation reported no
  changes. Example seeding inserted five offers and three transports.
- Managed ephemeral integration: 24 scenarios passed in the module run; the final
  UI scenario passed on targeted rerun after synchronizing the test with initial
  organization selection on every navigation. All 25 scenarios are verified.
  The UI scenario verifies Order 3/4/5, exhausted capacity, reload persistence and
  offer rejection. API tests cover concurrent allocation and stale writes.
- Local browser verification confirmed two logistics menu entries, database-backed
  lists, carrier approval, Order 3 creation and remaining capacity recalculation.
- Local role-ACL synchronization and global structural-cache invalidation were not
  performed: automatic approval review rejected their broader operational scope.
  Verification used the existing superadmin account without changing its access.
- Commands record before/after audit snapshots and emit CRUD effects after commit.
  Generic undo is disabled: restoring an older allocation snapshot could overwrite
  later transport decisions. No undo UI is part of this revision.

## Changelog

- 2026-09-19: Initially delivered the explicitly approved session-only demonstration.
- 2026-09-19: Revised to persistent scoped offers/transports, two sidebar entries,
  repeated numbered loads, rejection, guarded decisions and isolated test fixtures.
