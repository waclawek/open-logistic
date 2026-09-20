# Sales-backed dispatcher panel

Date: 2026-09-19. Status: implemented; post-transfer tests skipped at user request.

## Overview / Problem Statement

The user explicitly selected a combined implementation: transports backed by Sales orders,
working dispatcher decisions, separate rich transport detail pages, AI Inbox redirecting to
inbox_ops, a separate diagnostic webhook inbox, and Trans.eu/TIMOCOM/Eurodebt simulators plus
GraphHopper demo. This supersedes the dedicated-transport model in the earlier dispatcher spec.
The source reference is juliajakubowskabiznes/open-logistic at 6d47e9a1789e714b9114faa23a224b7c0fb09088.

## Proposed Solution / Architecture

Keep vertical behavior inside app modules. Extend SalesOrder and customer company profiles
through ce.ts; invoke the existing Sales command bus for document writes. Transport quotes created
from Inbox proposals use a versioned `metadata.logistics` envelope that the standard Sales
Quote → Order conversion copies unchanged. This keeps Sales package code unmodified while the
Logistics read model supports both the metadata envelope and legacy custom-field-backed transports.
Reference customers for CRUD/security patterns. No production dependency additions. The user explicitly approved
an additive CommandRuntimeContext.deferredSideEffects queue and Sales/CommandBus support
for delaying externally visible effects until the composing transaction commits.

Order 1 is a client SalesOrder, Order 2 an active carrier SalesOrder, and Order 3 onward are
additional-load SalesOrders linked by scalar custom-field transport_parent_id. Customer identity
uses existing customer records and snapshots. Keep persisted LogisticsOffer records for candidate
selection and rejection. The diagnostic inbox does not create business offers automatically.

## Data Models and Invariants

- Sales transport fields include transport_role/parent_id, pickup and delivery, cargo kg/pallets,
  client price and carrier budget/cost, vehicle type/registration/capacity snapshot, exchange source
  and reference, source offer id, and additional transport order number.
- Inbox-created client transport quotes add the same client-facing route, window, cargo, price and
  source values under `metadata.logistics` with `version: 1`, `transportRole: client` and
  `transportOrderNumber: 1`. The marker is system-assigned; neither users nor the extraction model
  choose the transport role. Existing `transport_role` custom fields remain supported for backward
  compatibility and for carrier/additional-load Sales Orders.
- Every lookup is scoped by tenant and selected organization. Sales reads use decryption helpers.
- Carrier/load proposals are pending_approval, approved or rejected. The current carrier excludes
  rejected history; replacing a rejected carrier preserves its historical record.
- Remaining capacity subtracts Order 1 plus every approved additional load, independently in kg
  and pallet spaces. Both dimensions must fit and carrier must be approved for allocation.
- Lock parent, child and selected offer during decisions. One offer can be allocated only once.
  The detail and row updatedAt are the aggregate decision version (latest parent/child edit);
  child mutation guards get the child version. An additional transportVersion fingerprint
  covers membership changes, including a child deleted directly in Sales. Locks/deletion
  use the complete linked graph, independently of which children are displayed.
  Stale decisions produce HTTP 409 and the shared conflict UI.
- Sales command writes, custom fields and offer allocation must commit or roll back together;
  deferred indexing/events run after commit. Do not bypass Sales guards or audit records.

## Vehicle capacities and tariff catalog

The corrected user table is the source for vehicle-types.ts. Minimum prices apply to
hiring the vehicle; the tail-lift surcharge is a separate, one-time EUR fee for either
body type. It is not a per-kilometre or per-pallet surcharge.

| Vehicle | Payload kg | Length m | Pallets | Curtainsider EUR/km | Curtainsider minimum EUR | Refrigerated EUR/km | Refrigerated minimum EUR | Tail lift EUR |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| FTL | 24000 | 13.6 | 33 | 1.2 | 500 | 1.4 | 600 | 400 |
| Solo 18t DMC | 9000 | 9 | 22 | 1.1 | 400 | 1.3 | 500 | 400 |
| Solo 12t DMC | 6000 | 7.2 | 18 | 1.0 | 400 | 1.2 | 500 | 400 |
| Solo 7.5t DMC | 3500 | 6 | 14 | 0.9 | 400 | 1.0 | 500 | 350 |
| Van 4.2×2.0×2.0 | 1000 | 4.2 | 8 | 0.8 | 300 | 0.9 | 400 | 250 |
| Panel van | 1000 | 3.2 | 4 | 0.6 | 300 | 0.9 | 400 | 250 |

Pricing will be supplied by a separate feature, per the user's latest instruction.
This module retains the corrected vehicle/tariff catalogue and accepts externally
provided prices. It has no automatic calculator, pricing form, pricing request object,
or apply_pricing decision. Existing order amounts are not changed by this removal.

## API Contracts

- GET /api/logistics/transports supports pagination, search, carrierStatus, date/update sorting;
  GET /api/logistics/transports/:id returns the rich Sales-backed detail.
- Inbox transport RFQs continue to use the standard `create_quote` proposal action. The Logistics
  app augments its extraction guidance and intercepts `sales.quotes.create` to attach the scoped,
  validated `metadata.logistics` envelope; it does not add a new core Inbox action type.
- POST /api/logistics/transports/:id/decision accepts approve_carrier, reject_carrier, accept_load
  (offerId or orderId), reject_load (orderId), returning the refreshed detail.
- Existing offer list/create/delete and reject decision endpoints remain available and scoped.
- Collection create/delete compatibility adapters must target Sales records and retain documented
  fixture behavior. Proposal creation supports a new carrier after rejection and pending loads.
- Logistics reads require logistics.view; writes logistics.manage. Inbox destination independently
  enforces inbox_ops.proposals.view. No authorization follows mutable role names.
- Diagnostic feed requires trans_inbox.view and filters by authenticated scope. Ingestion requires
  explicit development enablement and a shared token; tenant/org come only from server config.
  Reject oversized bodies; redact secrets; keep a bounded volatile diagnostic buffer.

## UI / Frontend Architecture Contract

Server page entrypoints host local client islands for table, details and diagnostic feed. Keep
legacy URLs reachable. The Logistics navigation entries are AI Inbox, AI Transports,
Transport jobs, and Agent inbox; root/ai-inbox redirect to /backend/inbox-ops. Transport rows
link to /backend/logistics/transports/:id.
Details show client/carrier financial information, vehicle capacity, history, repeated loads and
available offers with accept/reject controls. Use DataTable, semantic tokens, i18n in all five
locales, guarded mutations, explicit loading/error/empty states and organization-change resets.

## Demonstration Tools

Port source OpenAPI snapshots and three standalone scenario-driven simulators. Configure token
and target URL through environment variables; never store credentials in scenarios or reports.
GraphHopper remains an independent car-routing demo with a fixture, not a truck-routing service.
No automatic external requests, downloads, containers or provider accounts are needed to use the
main dispatcher panel. Simulators are development tools, not production provider adapters.

## Migration & Backward Compatibility

Legacy logistics_transports rows/table and migration history are retained. Existing Sales Orders
identified by the `transport_role` custom field stay readable; new Inbox-created client transports
may be identified by the versioned Logistics metadata envelope. No data rewrite is required.
Provide a scoped,
idempotent legacy-to-Sales CLI migration with dry-run default and explicit apply. Re-running must
not duplicate orders or reassign accepted offers. Preserve legacy source identifiers and allocated
offer references. Do not apply developer database migrations or data conversion in this task.
Keep existing ACL/event/extension IDs and legacy route entrypoints. The optional command-context queue preserves ordinary callers; rich detail/proposal routes
and custom fields are additive. Document any adapter
transition and rollout sequence in the module README and UPGRADE_NOTES.

## Risks & Impact Review

- High: concurrent loads overbook vehicle or allocate offer twice. Parent and offer locks plus
  optimistic version checks; integration concurrency test must have one winner.
- High: composed Sales writes commit outside outer transaction. Verify transaction-bound DI and
  custom-field writes with rollback tests; release indexing/events only after commit.
- High: diagnostic inbox exposes another organization. Auth-derived read scope, configured write
  scope, token and body bounds; test cross-tenant/org access and forged scope inputs.
- Medium: migration duplicates historical orders. Stable source mapping, locking and repeat-run
  checks; retain old rows, never delete for cutover.
- Medium: list read model retains the reference implementation limit of 1000 active
  transports per organization. Its error states the limit; direct detail lookup remains available.
- Medium: two active tasks overwrite each other. Implementation uses dedicated dispatcher-sales
  worktree and branch, preserving the original working directory and PR #11 work.

## Integration Coverage

Self-contained API fixtures cover transport list/detail/create/delete compatibility, filtering,
carrier approve/reject/replacement, repeated Order 3/4/5 allocations, rejected offer/load handling,
capacity boundaries, stale and concurrent writes, missing auth/permissions and organization scope.
Browser scenarios cover list-to-detail navigation, persisted decisions after reload, inbox redirect,
legacy URLs, mobile/keyboard navigation and Polish labels. Diagnostic tests cover feed isolation,
unauthorized ingestion, malformed/oversized payloads and secret redaction. Simulator dry runs and
local mock smoke checks require no provider credentials. Migration coverage checks dry-run and
idempotent repeat semantics. Run generated registries, types, focused Jest, package/app builds and
managed isolated integration environment; record actual results, never inferred success.

## Final Compliance Report

Implementation moved onto develop commit 3c77ef3f4de9affd1f7d345c5627fe47e20088e8 after PR #11 was merged. The PR's migrations, persisted offers and existing simulator/GraphHopper implementation are retained. Only the Sales-backed extension and required integration fixes are added. Runner: local.

The user subsequently requested tests on the transferred branch. Runner: local Windows; integration tests used fully managed ephemeral PostgreSQL and application instances, with enterprise modules disabled. The final logistics/trans_inbox run passed 31 scenarios with one explicit skip for the development-only diagnostic sink. It covered scoped access/navigation, persisted carrier and successive load decisions, concurrent allocation, stale aggregate versions, replacement carriers, rollback with zero escaped side effects, and idempotent legacy conversion. Package builds, generated artifacts and the production app build completed through the managed runner.

Selected Jest coverage passed 160 tests: 144 logistics/inbox tests, 10 Sales command tests and 6 shared command-cache tests. Thirty focused template parity, design-system and script checks passed. Testing exposed and fixed the offers availability preprocessor rejecting already-parsed booleans during the CRUD handler's second validation, a reset command-scope test mock, and a template checker conflict with an optional Alert style prop. All relevant app changes are mirrored into the template.

A broader native create-app run (excluding parity files) reported 630 passed, 30 failed and 143 skipped. Investigation separated two PR-related static module catalog/budget failures from 28 failures in unchanged Windows tooling and baseline harness assertions. The template sync transform now keeps the standalone default module catalog static while preserving the monorepo slim mode and conditional official/enterprise/S3 registrations; all 11 focused module parity and instruction-budget checks pass after that correction. The full 803-test run was not repeated after the correction. The baseline classification is based on source comparison; a separate develop run was not performed. Full repository CI, standalone Verdaccio execution and manual QA are not claimed complete. The existing Node 24 OpenAPI JSON import issue still triggers the static fallback, which omits generated request/response schemas.

Developer database migrations and legacy data conversion were not applied. GraphHopper map import and server startup were not performed.

## Changelog

- 2026-09-19: User approved Sales-backed combined architecture and isolated worktree implementation.
- 2026-09-19: User approved the concrete shared/Sales post-commit effect bridge and fully managed isolated integration runs.

- 2026-09-19: User explicitly approved deleting all linked Sales orders when deleting a transport, including inactive/cancelled carrier orders.

- 2026-09-19: User requested comparison with merged PR #11, moving only needed changes onto current develop, and skipping further tests.

- 2026-09-19: Applied corrected user tariff table: FTL 24000 kg / 13.6 m / 33 pallets, Solo 18t payload 9000 kg; clarified vehicle minimum charges and one-time tail-lift surcharge.

- 2026-09-19: Connected tariff calculation to optional transport creation and the guarded Order 1 pricing action; added live detail form and saved tariff snapshot.

- 2026-09-19: Removed the automatic pricing implementation at user request; pricing will come from a separate feature. Retained vehicle catalogue and existing manually/external-supplied prices.

- 2026-09-19: User requested tests; fixed repeated boolean query validation and verified the Sales-backed dispatcher in an isolated integration environment (31 passed, one development-only skip).

- 2026-09-19: Added the app-level Inbox Proposal → Sales Quote → Sales Order handoff design. New
  transport quotes carry a versioned `metadata.logistics` envelope copied by the existing Sales
  conversion; AI Transports remains compatible with legacy `transport_role` custom fields, and no
  Sales package source changes are required.

- 2026-09-19: Verified the handoff with focused unit coverage (9 tests), app typechecking and lint,
  plus isolated integration case TC-LOG-012 covering proposal acceptance, quote conversion,
  metadata propagation and AI Transports visibility.

- 2026-09-20: Fixed the AI Transports collection query for encrypted Sales Order metadata. The
  read model now selects scoped orders with metadata, decrypts them, and applies the versioned
  Logistics marker in memory. TC-LOG-012 now asserts visibility through the unfiltered collection
  endpoint rather than the detail-by-ID shortcut.
