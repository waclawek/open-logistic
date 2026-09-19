# Logistics implementation contract

Status: design candidate after user confirmation on 2026-09-19. This shared contract refines the [App Spec](../2026-09-19-app-spec-logistics-operations.md) for seven feature specifications. It is not another independently releasable capability. App Spec invariants and DA01–DA12 remain normative.

## Placement, identity and compatibility

Only `apps/mercato/src/modules/logistics` owns new business code. Preserve `logistics.view`, seven navigation URLs and existing role behavior. Customers, Resources, Staff and Planner own masters; query authorized public projections through the query engine or sanctioned service, never their ORM entities. No core changes or new production dependency. New grants are explicit; existing viewers do not acquire write permissions. New tables and discovery files are additive; all thirteen BACKWARD_COMPATIBILITY surfaces remain unchanged.

All route inputs are strict zod schemas in `data/validators.ts`, with inferred types. Public input cannot choose scope, actor, status or derived snapshots. Scope comes from the authenticated active organization and tenant; null organization returns the platform scope-required error. Every reference/query/receipt lookup includes both scope IDs and current exact/wildcard authorization. Drivers remain personnel, not login accounts.

## Persistence and confidentiality

Use MikroORM v7 legacy decorators, UUID IDs, snake_case logistics tables, scope/timestamps and soft deletion where applicable. Decimal DB values and decimal-string API input use scaled integer arithmetic: kilograms to three fractional digits, odometers to one. Never accumulate floating-point distance. Snapshot objects have explicit bounded zod shapes. Normalize unbounded memberships, cohort vehicles and receipt results into child rows while exposing the logical App Spec arrays.

Indexes lead with tenant/organization: trip status/planned time/id; job status/creation/id; assignment resource/start; trip stop sequence; mileage vehicle/start; vehicle/day; correction successor; receipt actor/action/requestId; disruption trip/fingerprint. Unique active job membership and current trip assignment back the command guards. Profile rows provide lock anchors when no booking exists. Lists page at <=100, batch references and paginate histories; counts cover all records, not the first page.

`encryption.ts` exports `defaultEncryptionMaps`. Encrypt registration (with hash sibling for scoped exact uniqueness), profile places/notes, customer name/reference/cargo/places/notes, trip places/notes, stop place/reason, operational evidence/notes/reportedBy, promise reason/agreedWith, plan snapshot, disruption description/resolution, handover place/reason/evidence/reportedBy, release reason, mileage places/reason/evidence/provenance and cohort name. Non-sensitive timestamps/states/numbers remain queryable. Use platform write hooks and scoped `findWithDecryption`/`findOneWithDecryption`; no custom crypto or plaintext private-data indexing/logging.

## Commands, concurrency and effects

Every mutation registers a command. Ordinary CRUD uses `makeCrudRoute`, indexer and customers custom-field/undo helpers. Action routes export per-method metadata/OpenAPI; collect mutation guards plus `bridgeLegacyGuard`, supply userFeatures, revalidate modified payload and run callbacks after success. Commands also enforce scope/features/versions. Every editable row returns updatedAt; child mutations use their own versions. Aggregate plan/fact/vehicle-ledger revisions protect compound changes.

Use one outer database transaction. Lock own-module profile, trip, job and ledger anchors in canonical scope/entity-kind/UUID order, then reread state. Lock resources before querying overlapping bookings. Positive half-open intervals allow adjacency; unreleased active occupancy blocks beyond planned end. Failed replacement retains previous booking. Constraints provide a second barrier; competing losers return scoped409. Emit side effects only after the actual outer commit, not after a nested flush.

Receipt and state commit atomically. Authorize replay, serialize receipt keys, hash canonical validated input. Same key/body returns original outcome; changed body conflicts. Replay/status lookup uses current permission. Postcommit effects are reported through telemetry without claiming rollback; lost response reconciles by requestId. No custody transition depends on a subscriber. Invalidate entity list aliases and query indexes for every affected entity after commit/undo.

Undo of unreferenced draft/profile edits uses guarded snapshots and `extractUndoPayload`; create undo soft-deletes only without dependencies. Accepted job reversal requires never-assigned/no-dependent-history state. Confirmed/physical actions reject generic snapshot undo: unassign/cancel/replan, return, handover or audited correction is the compensating path. Never overwrite later execution. Correction rejects downstream contradictions; no force repair API.

## API and authoritative reads

App Spec A01–A16 paths/fields are authoritative. Factory list/detail formats include id/updatedAt. Action requests contain requestId, expectedUpdatedAt/revisions and typed business payload; responses contain affected IDs/versions and receipt reference. No generic writes to internal observations/receipts/memberships/facts. Errors follow shared helpers:400/422 validation,401/403 authorization, nondisclosing404,409 conflict,503 unavailable.

Selectors/board/statistics use no-store authoritative reads. Factory caches use scoped aliases invalidated after writes/undo; no custom cache. Partial/unreadable sources never imply availability. Stored history permits execution during source outages. GET never persists source observations or disruptions.

## Frontend architecture contract

Generated page roots remain server components rendering small route-local client leaves; preserve metadata. DataTable and CrudForm use stable entity/extension IDs and custom-field helpers. Other writes use `useGuardedMutation`, retryLastMutation, own-record version headers, apiCall helpers and conflict UI. Dedicated loading/notFound/error/ready states; failures never become zero counts. Use shared semantic-token primitives, keyboard submit/cancel and labelled buttons. Operational strings exist in en/pl/de/es/ko.

Each feature spec lists client leaves and their browser-state purpose. Every leaf <=300 lines; split form/table/dialog responsibilities when larger. Budgets:0 new client page roots,0 heavy root imports,0 global providers; <=100 displayed rows, batched references, one request per visible refresh cycle except paged selectors. Capture route build/chunk signal and hydration/interaction proof; run `yarn check:client-boundaries`. Any exception is documented before release.

## Delivery and tests

Seven capabilities: fleet readiness, job intake, trip operations (one coupled custody lifecycle), report correction, mileage reconciliation, cohort comparison and board projection. Additive capabilities can be built/tested independently against contracts; expose the pilot only when the complete loop passes. Follow approved C01–C25 dependencies with tests in owning increments; retain the33 provisional estimate without dropping failure paths.

Self-contained module Playwright fixtures create and clean their scoped records. Pure units prove arithmetic/predicates; real concurrent requests prove DB locks/receipts. LOG-OP-01..16, DA01..12 and the ordered root validation gate remain required. Generate discovery and scoped migration/snapshot; no developer/production migration without separate authorization. Use the standard isolated integration harness. Preserve foundation tests and in-flight completion/recovery on rollback.

## Market comparison

ERPNext's [Delivery Trip](https://docs.frappe.io/erpnext/delivery-trip) combines stops, vehicle and driver. Adopt explicit manual planning; its route optimization is excluded. Odoo [service records](https://www.odoo.com/documentation/17.0/applications/hr/fleet/service.html) associate odometer evidence with maintenance. Account for non-delivery movement here too; fixed-cohort completeness/custody classification remain additional approved requirements.

## Readiness

Root/core/customers/shared/UI/backend/events/CLI/QA guides and approved App Spec govern implementation. All13 compatibility surfaces are additive/unchanged. Runtime command/guard/encryption/transaction correctness remains unverified. Fresh cohesion review and readiness audit must close actual design blockers. Business scope and placement are already confirmed.

## Readiness audit resolutions R1–R6

R1: the encryption inventory above includes nested snapshot copies; source filtering must use authorized query-engine exact identifiers or permitted hashed registration lookup, never plaintext contact/address indexes or ilike over encrypted fields.

R2: all existing-record mutation schemas require an ISO UTC expectedUpdatedAt, plus nonnegative integer expectedPlanRevision/expectedFactRevision/expectedLedgerRevision for affected streams. Reject missing/malformed inputs before shared compatibility helpers; compare under locks even when OM_OPTIMISTIC_LOCK is off. Compound commands require explicit {id, expectedUpdatedAt} for every affected trip/job/profile, with revisions for every changed stream. Create has no prior row version but locks identity/receipt keys. Returns standard conflict payloads. UI passes child versions rather than parent headers.

R3: VehicleProfile owns ledgerRevision (integer, default0, server-only); creation provides the stable ledger anchor. Every ledger/correction/reconciliation action locks that vehicle row; increment on effective ledger changes, and store reviewed revision in VehicleDay. Lock order for every command, including profile edits/undo: scoped receipt advisory lock first, then profile rows sorted by type/UUID, trips sorted UUID, jobs sorted UUID, then owned children. Use parameterized PostgreSQL transaction advisory lock over a deterministic scope+actor+action+requestId key, then scoped receipt lookup; hash collisions only serialize extra work. Resource/profile row locks precede absent-reservation queries. The outer transaction owns receipts/state and after-commit effects. Registration/profile creation uniqueness uses DB constraints, not an absent-row lock.

R4: generic undo is allowed only for safe unreferenced drafts/profile edits; recheck dependent memberships/facts and frozen cohort under the same locks. Profile undo cannot change eligibility/capacity beneath a reserved/active trip without the same command revalidation. Cohort freeze is irreversible in this release; a changed population creates a new cohort. Physical commands explicitly isUndoable=false; correction is their reviewed compensation.

R5: A16 GET /commands/[requestId] requires validated action query parameter to disambiguate the scoped actor/action/requestId receipt. Return the original committed IDs/versions (not a newly calculated result); UI then reloads current records. Before sending, retain only requestId/action/record IDs in the shared browser safeLocalStorage helper under tenant+organization+actor namespace, not cargo/PII. On reopen, query receipt before allowing resubmission; no receipt does not prove an in-flight request has failed. Recheck after in-flight resolution or retry identical input with the retained ID. If original input is unavailable, require record reconciliation instead of inventing a new duplicate request. Clear on confirmed outcome/logout and never replay into a different scope. Browser retention failure must surface an uncertain outcome with a copyable requestId.

R6: update only placeholder assertions for operational pages, retain all seven navigation/access/scope/session/locale regressions and planned map/proposals states. Append-only integration fixtures run in isolated disposable test databases owned by the existing ephemeral harness; destroy only that harness-owned environment. No production delete endpoints or local developer DB reset. API-created ordinary fixtures use existing cleanup helpers; retained fact fixtures are removed with isolated database teardown.

Implementation transaction boundary: the receipted entry command owns the outermost transaction and rejects caller-owned transactions. Compound operations must call shared domain mutation functions inside that entry transaction, not execute nested registered commands. Result rows are normalized with sequence, entity type, record UUID, updatedAt and nullable stream revisions. Replays return those committed versions even if current records have since changed. Mutable entity onUpdate hooks advance updatedAt monotonically by at least one millisecond, including same-clock-tick writes; results are captured after flush.

Command authorization review R1/R2: require a concrete trusted selectedOrganizationId; explicit null/all-organizations never falls back to actorOrgId. Clear the incoming isSuperAdmin claim before the existing fresh directory scope service reloads ACLs; its fresh ACL can still grant legitimate superadmin and descendant access. Regression tests exercise the actual default scope service/resolver for revoke/replay, live descendant grants, deleted organization and null selection. This release executes as internal authenticated users; API-key actors are explicitly rejected. Future keyed invocation needs a separately reviewed principal/receipt namespace contract rather than replacing a user UUID with a key UUID.

The installed shared code-review reference is absent. Apply the available .ai/review-checklist.md and current root/module rules, as recorded by the readiness audit; do not claim execution of the missing file. Current backward compatibility document has fourteen categories, including AI identities: those are also unchanged (AI excluded).

## Feature-review resolution

F1/F2: a maintainer organization question was presented asynchronously. With no reply and the approved handoff already requiring one independently deployable capability per spec, proceed with the recommended seven focused documents; no scope, architecture, release gate or implementation requirement is reduced. F3: transient trip-free eligibility distinguished from persisted trip observation. F4: unassigned promises explicitly owned by intake, assigned revisions delegate to trip replanning.

Draft-write implementation refinement: normalize and sanitize/validate/write custom fields through existing platform helpers with the same active transactional EntityManager; flush parent scalars before definition queries. Capture scalar/custom-field undo snapshots under the owning job lock, keep them in encrypted action-log metadata, and return only IDs/versions in public receipts. Replays skip duplicate undo-log creation. Draft undo/redo rechecks current authorization, unaccepted/unassigned state and recorded snapshots; creation undo soft-deletes and redo restores the same ID.
