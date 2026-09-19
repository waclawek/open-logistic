# Pre-Implementation Analysis: Logistics operations

Date: 2026-09-19. Reviewer branch: `cez/ecf615c7`. Reviewed parent/fork: `cez/32c60056` at `da4f4237ac186c35b7ead255854746dfa2fb2f2e`.

## Executive Summary

**Verdict: changes — narrow implementation-readiness additions, not renewed business discovery.** The user-approved App Spec is ready for feature decomposition in the existing `apps/mercato/src/modules/logistics` module. Before implementing the affected persistence/action slices, feature specs must make encryption, mandatory version validation, locking/receipt mechanics and command undo policy concrete. No proposed breaking change or need for a core modification was established. Runtime acceptance remains unverified.

This reviews the approved snapshot, not concurrently authored feature specs/dependency preparation. `git diff da4f4237a..cez/32c60056 --name-only` was empty during inspection: parent and reviewer fork contained the same approved tree. There was no parent implementation report to validate. The complete App Spec was read; previous independent business gates are accepted as instructed.

## Backward Compatibility

### Violations Found

No existing contract removal, rename or narrowing is proposed. All thirteen surfaces required by the installed pre-implementation skill were checked below. **The current `BACKWARD_COMPATIBILITY.md` actually has fourteen categories:** AI identities were inserted at #12, moving CLI/generated contracts to #13/#14. The additional category is also checked; using the skill's older numbering must not skip it.

| Skill # / surface | Current evidence and disposition | Implementation obligation |
|---|---|---|
| 1 Auto-discovery (FROZEN) | Logistics already exports `metadata`, `features`, `setup`; seven `backend/logistics/**/page.tsx` routes exist. No entities, API, command, event or encryption files currently exist in that module. Additive. | Preserve exports; add convention files and run generation. Use actual resource route patterns such as `resources/api/resources.ts`, not an inferred routing convention. |
| 2 Types/interfaces (STABLE) | `logistics/lib/sections.ts:10` exports `LogisticsSectionId`; the spec keeps its destinations. Planner service has a narrow rules/range interface (`planner/services/plannerAvailabilityService.ts:6`). | Keep shared types intact; transport states belong in schedule metadata. Introduce local adapter/domain types, not changed platform interfaces. |
| 3 Function signatures (STABLE) | `makeCrudRoute`, `withAtomicFlush`, `runCrudCommandWrite` and five-argument decryption helpers already exist. No signature changes requested. | Use their real behavior described below; no core helper patch. |
| 4 Import paths (STABLE) | Existing logistics component/section paths remain; staff is an optional source, not a new hard business-logic import. | Keep old exports; resolve peer IDs/services at runtime. No direct staff ORM imports. |
| 5 Event IDs (FROZEN) | No logistics `events.ts` in current inventory; proposed `logistics.job.*`, `trip.*`, custody/mileage events are additions. | Declare with `createModuleEvents` and `as const`; preserve source events. Correction/replay must not duplicate physical-action events. |
| 6 Widget spots (FROZEN) | Current `components/LogisticsPage.tsx` renders PageHeader/EmptyState/navigation; no custom logistics injection spots. Spec explicitly needs no cross-module injection. | Use stable `entityId`/`extensionTableId` for new tables/forms; do not change shared spots or context shapes. |
| 7 API URLs (STABLE) | No logistics API files currently; A01–A16 are proposed additions. Source resource/staff/planner APIs remain unchanged. | Preserve seven backend URLs and GET read semantics; define method metadata, OpenAPI and exact action responses. |
| 8 DB schema (ADDITIVE-ONLY) | No logistics `data/entities.ts` or migrations; owned profiles/facts/receipts are new tables. | UUID references/snapshots; no source-table edits or cross-module ORM relations. Include scoped indexes, migration and snapshot. No migration execution in this audit. |
| 9 DI keys (STABLE) | `planner/di.ts:7` registers `plannerAvailabilityService`; service merges supplied rules and does not load/authorize sources or reserve resources. | Soft-resolve this unchanged key; app-owned services may be added. Missing service yields unknown eligibility. |
| 10 ACL IDs (FROZEN) | `logistics/acl.ts:2` declares only `logistics.view`; `setup.ts:5` grants admin only that feature; page metadata requires it. | Retain read-only meaning. Add seven write features and explicit setup grants; existing tenant role sync must not promote viewers. Source read grants are separate. |
| 11 Notification IDs (FROZEN) | No logistics notifications file; v1 deliberately excludes notification automation. | No new notification pipeline needed; preserve existing module notifications. |
| 12 CLI (current #13, STABLE) | No logistics CLI file; only existing generate/migration/ACL commands are reused. | No command rename or altered defaults. |
| 13 Generated contracts (current #14, STABLE) | `apps/mercato/src/modules.ts:72,102–104` already enables logistics/planner/resources/staff. | Generate registries; never hand-edit. No bootstrap export changes or broad app-shell/template churn. |
| Additional current #12 AI IDs (FROZEN/STABLE) | No logistics agents/tools/UI-part/override identities in inventory; AI is explicitly excluded. | No AI contract changes. |

### Missing BC Section

None: App Spec lines 597–622 include API contracts and Migration & Backward Compatibility. Each feature spec should repeat its exact additive footprint; there is no justified deprecation/bridge requirement today.

## Spec Completeness

### Missing Sections

None at App Spec level: overview/problem/solution, domain model, architecture, APIs, UI, risks, phasing, implementation sequence, integration coverage, compliance and changelog are present. The C01–C25 ledger is planning, not implementation proof. No business gate should be reopened.

### Incomplete Sections

| Severity / ID | Location | Implementation detail to resolve in owning feature spec |
|---|---|---|
| High / R1 | App Spec 69–109, 349–387 | Explicit module encryption map and search/index policy for addresses/contacts, customer snapshots, driver notes, facts/reasons, promise agreement identity, recovery reporter/evidence and nested plan/place snapshots. Define encrypted equality lookup/hash companions where needed. |
| High / R2 | App Spec 137, 597–620 | Exact required expected-version schemas for every mutation, including all affected trip/job/profile/ledger aggregates; missing or malformed version must not silently bypass the mandatory logistics contract. |
| High / R3 | App Spec 129–139, 381–383; C08/C14/C16/C18 | Concrete stable lock order, always-existing serialization rows/keys, scoped uniqueness and receipt claim/replay algorithm. Choose the physical vehicle-ledger revision owner referenced by correction/reconciliation; it is not a fully defined entity in the App Spec. |
| Medium / R4 | App Spec 137–139; C01–C20 | Per-command undo policy: safe draft/profile operations may use guarded undo; physical facts use correction, never generic reversal. Define preconditions preventing undo of a profile/job already used by execution or a frozen cohort. |
| Medium / R5 | A16, App Spec 106, 615 | Receipt key includes actor/scope/action/requestId, but status URL contains only requestId. Define action disambiguation and replay response/version semantics; reauthorize before returning a receipt. Specify browser retention/recovery of original requestId after an uncertain outcome. |
| Medium / R6 | Validation 626–649; current foundation tests | Replace only obsolete placeholder assertions as pages become operational; retain navigation/access/locale regressions. Define cleanup for append-only facts/no-delete APIs, e.g. isolated disposable test database with a reviewed teardown, not new production deletion endpoints. |

These are engineering handoff gaps, not assertions that approved business behavior is wrong.

## AGENTS.md Compliance

### Violations / required implementation safeguards

R1 is a missing mandatory persistence declaration; no plaintext implementation has shipped. Other rows are preventive readiness requirements, not findings against nonexistent code.

- **Encryption:** `customers/encryption.ts:3–16` maps address columns; `sales/encryption.ts:5–15` maps entire snapshot fields. Add logistics `encryption.ts` exporting `defaultEncryptionMaps` using the canonical module type. Include snapshot copies, not just live fields. The current spec has no explicit encryption section. Decide how place filtering works with encrypted fields; do not copy `$ilike` over ciphertext or index contact/note content indiscriminately.
- **Scoped reads:** `packages/shared/src/lib/encryption/find.ts:21–42,48–69` passes `where` to ORM unchanged; the fifth argument supplies key scope, not tenant filtering. Every custom action/child/receipt loader needs tenantId AND organizationId in `where`, plus applicable deletion predicate. A four-argument scope example in shared guidance must not override the actual signature.
- **CRUD reference:** use customers command/API patterns, and the compact `resources/api/resources.ts:58–99` example: `orm`, scoped fields, `indexer`, list schema and per-method metadata. Factory config is not literally the abbreviated `{ entity, operations }` sketch in the readiness skill. Internal facts/memberships/receipts get no generic write route.
- **Custom guards:** `packages/shared/src/lib/crud/route-mutation-guard.ts:129` collects registry + legacy guards; `staff/api/timesheets/settings/route.ts:142–170` shows `runRouteMutationGuards`, blocked response, reparsing `modifiedPayload`, then `runAfterSuccess`. Reuse the shared wrapper with correctly resolved features; it is not itself an authorization check. Preserve command-interceptor rejection bodies via `getCommandInterceptorHttpRejection`; keep protected fields server-derived after guard transformations. Log/report callback failures without describing committed work as rolled back.
- **Required versions:** `optimistic-lock-command.ts:121–133` deliberately returns for missing/unparseable expected/current tokens or disabled locking. Therefore `enforceCommandOptimisticLock` alone does not enforce the App Spec's mandatory version policy. Validate required input first, compare under logistics serialization and keep domain revision checks effective independent of optional UI guard behavior. Use standard conflict bodies/UI. `CrudForm` initial values need updatedAt; custom actions need scoped headers and `surfaceRecordConflict`; child writes require their own versions.
- **Atomicity/side effects:** `withAtomicFlush` (`flush.ts:119–187`) flushes each phase, joins an ambient transaction, and only commits when it owns the transaction. `runCrudCommandWrite.ts:47–83` calls this helper, then writes custom fields and emits effects immediately; it is not an outer-transaction post-commit scheduler. Do not nest it with emission inside a larger handover/booking transaction. Keep one logistics transaction/EM for locks, facts, revisions and receipt; only the outer owner emits/indexes/invalidates after commit. The App Spec already correctly states this boundary.
- **Locks:** existing `wms/commands/inventory-actions.ts:368–379` demonstrates `findOneWithDecryption(..., { lockMode: LockMode.PESSIMISTIC_WRITE }, scope)`; use only the lock-option idiom, adding scope to WHERE rather than copying its broader query. Lock a stable logistics vehicle/driver profile and job row before checking absent reservations, in globally sorted order; locking only existing conflicting bookings does not serialize an empty result. Unique active membership/receipt/successor indexes supplement locks. Profile capacity/disable writes must use the same serialization seam.
- **Undo/audit:** customers `commands/people.ts:740–776,1081–1106` supplies command logs and `extractUndoPayload`. `commands/types.ts:155–167` supports `isUndoable` and optional undo. Explicitly mark physical actions non-undoable; correction commands own their history. Fresh/forked after-snapshots avoid identity-map stale logs.
- **UI:** existing header/section exports can remain; compose DataTable/CrudForm/KpiCard/ScheduleView with DS tokens, five existing locales, standard errors and keyboard dialogs. Non-CrudForm writes use `useGuardedMutation`. Stable row action IDs and table extension IDs are needed. No standalone DS health report was generated because only this report may be written.

## Source Adapter Evidence

- `resources/api/resources.ts:35–99` exposes resources.view, scope, active flag, availability_rule_set_id and updated_at; `staff/api/team-members.ts:33–84` exposes the analogous staff.view projection without requiring a user account. Its generic response includes fields beyond dispatch needs: never forward the whole response to logistics selectors.
- `planner/api/availability.ts:37–106` exposes planner.view, paginated subjectType/subjectIds rules with scope, timezone, rrule, exdates, kind and updated_at; `api/availability-rule-sets.ts:10–75` exposes the linked set. Read all pages and verify complete membership; unavailable is different from an empty rule set. Choose API or authorized query-engine projection in C09, including the exact selected-org propagation and absent-module handling.
- `planner/components/AvailabilityRulesEditor.tsx:487` selects linked rules only when saved custom rules are empty (plus browser-local override UI state). `planner/services/plannerAvailabilityService.ts:6–22` only merges given rules. Logistics must select/authorize/validate before invoking it.
- `planner/lib/availabilityMerge.ts` parses permissive recurrence strings and has a special day-override path. Retain the already-approved conservative grammar, COUNT=1 exclusions, midnight-crossing combinations and zero-second boundaries. Their runtime proof is outstanding; no new scheduler/core patch is justified.

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Missing token accepted by shared compatibility helper | Lost updates despite a versioned UI | R2 required schemas, locked comparison; missing/malformed/disabled-guard tests |
| Nonexistent reservation rows or inconsistent lock ordering | Double booking/custody or deadlocks | R3 stable scoped resource/job locks, deterministic order, unique constraints; parallel real PostgreSQL requests |
| Snapshot PII or searchable plaintext copies | Privacy exposure | R1 full encryption/search inventory and encrypted-tenant round-trip tests |
| Nested helper emits before outer commit | Phantom events/index entries on rollback | Explicit outer owner; inject late-phase failure and prove no events/receipt/domain change |
| Correction/handover partially updates ledger or custody | Corrupted physical history | Atomic multi-aggregate revisions, one successor, approved LOG-OP-10/11/12 adversarial cases |

### Medium Risks

Source pagination can produce a mixed observation during concurrent source edits; retain the documented observed-snapshot consistency and source versions, never promise source locking. R5 ambiguous status lookup/changed-body retry needs a concrete contract. Foundation tests will fail legitimately when implemented pages cease to be placeholders. Runtime toolchain is not prepared in this review worktree.

### Low Risks

No external provider, new production package, custom worker, map or AI integration is needed. Existing UI component reuse reduces scaffolding risk; global search, custom caches and notifications should remain absent unless an owning feature needs them.

## Gap Analysis

### Critical Gaps (Block Affected Implementation)

R1–R3 must be specified before their persistence/action slices are considered implementation-ready. They can be closed in the feature specs currently being authored without revisiting accepted business scope. There is no proven BC violation or need for major revision.

### Important Gaps (Should Address)

R4–R6; specify zod public versus trusted internal input, openApi/metadata, receipt digest canonicalization, exact decimal serialization/rounding and after-commit invalidation per affected entity. Use available exact arithmetic or scaled integers within validated bounds; no dependency addition is authorized here. Explicitly distinguish no cache from cached projections requiring DI tenant/org tags.

### Nice-to-Have Gaps

None required for this release. Do not expand into generic booking, routing, automation or new integration infrastructure.

## Verification and Limitations

**Runner: local.** DOCKER_COMPOSE_FILE unset; no local dev override candidates found. `docker compose --project-directory . -f starters/docker/compose.fullapp.dev.yml ps --status running -q app` returned exit 0 with no app ID. The next candidate `compose.fullapp.yml` failed interpolation because required JWT_SECRET was absent. No secret was read, created or changed; no container was started.

Actual checks:

- `node --version`: v24.19.0; `yarn --version`: 4.17.1, matching package.json requirements.
- `Test-Path node_modules`, `.yarn/install-state.gz`, `.ai/qa/ephemeral-env.json`: all false.
- `yarn test --runInBand --runTestsByPath apps/mercato/src/modules/logistics/__tests__/pages.test.tsx`: **blocked before Jest**, "Couldn't find the node_modules state file". Zero tests executed; this is not a test failure in logistics logic or a pass.
- `git diff --check`: passed before report creation; report checked again before commit. Scoped inventory/diff reviewed; no source modifications.
- Existing `logistics/__tests__/pages.test.tsx:45–63` asserts planned text and absence of form/table/input/button/canvas on every page. Seven integration files TC-LOG-001–007 cover foundation navigation/access/scope/mobile/session/locales/existing navigation, not operational correctness. LOG-OP-01–16 remain proposed.

No install, generation, build, typecheck, migration, API integration, browser QA, encryption round-trip or real concurrency test ran. Dependency preparation in the parent does not establish readiness in this separate worktree. No historical verification is recast as a result from this audit.

Guidance used: installed `C:/Dev/open-logistic/.ai/skills/om-pre-implement-spec/SKILL.md`, root router, `.ai/specs/AGENTS.md`, core/shared/UI/backend/customers/staff/CLI and QA guides, module-development/runner docs, UI/DS references and actual source above. Searched OSS/enterprise spec inventories; optimistic-locking and staff-decoupling references retained.

**Checklist limitation:** `.agents/skills/om-code-review/references/review-checklist.md` and the same absolute path under `C:/Dev/open-logistic` are absent. Installed `.ai/skills/om-code-review/SKILL.md` is only the repo extension, referring to the missing shared installation. Applied available `.ai/review-checklist.md`; do not claim the missing shared checklist was executed. Its legacy encryption-defaults/migration/always-undoable bullets are superseded by module encryption maps, root scoped-migration exception and the explicitly approved correction-only physical-fact policy.

Only matching tagged lesson records were opened: terminal-transport-outcomes-settle-obligations; decryption-scope-argument-is-not-a-where-filter; cross-module-query-precedent-is-not-permission-to-copy; avoid-identity-map-stale-snapshots-in-command-logs; weve-got-centralized-helpers-for-extracting-undopayload. No lesson edits or bulk lesson reads.

## Remediation Plan

### Before Implementation (Must Do)

1. Feature-spec owners close R1–R3 with actual schemas/maps, version/lock ownership and one transaction/receipt algorithm; retain all approved DA01–DA12.
2. Document R4–R6 and map each new API method/UI action to its LOG-OP coverage, including isolation and cleanup.
3. Parent prepares dependencies and an authorized isolated runtime; this audit does not authorize migrations or source changes outside logistics.

### During Implementation (Add to Spec)

Ship each slice's unit/API/UI evidence with its change, including absent-source behavior, encrypted scoped reads, wildcard/revoked ACLs, mandatory missing-token rejection, rollback, uncertain outcome and parallel locking tests. Refresh only superseded planned-page assertions; preserve map and excluded proposals honesty. Generate module registrations/migrations/snapshots with no handwritten registries.

### Post-Implementation (Follow Up)

Run the exact configured gate: build:packages → generate → build:packages → i18n:check-sync → i18n:check-usage → typecheck → test → build:app. Then execute focused operational integrations and actual UI QA in an authorized environment, retaining failures/Windows limitations. Validate the complete manual loop before pilot release; configure cohort/timezone/dates and boundary-reading practices separately.

## Recommendation

**Needs targeted feature-spec updates first (`changes`), not major App Spec revision.** Proceed with approved decomposition and dependency preparation. No core change is indicated. Operational readiness cannot be approved until the named engineering gaps and real runtime acceptance checks are closed.
