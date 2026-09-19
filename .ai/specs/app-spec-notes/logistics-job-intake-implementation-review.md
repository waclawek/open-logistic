# Logistics draft-job and HTTP implementation review

Date: 2026-09-19. Verdict: **changes — scoped slice only**.

Reviewed parent `cez/32c60056` at `75cbf71ce444bd907bb2b83ade9764bcc9250575`, also this worktree's fork point. Fork-point-to-parent diff was empty. Inspected the complete new slice `git diff 2027f0d4f..75cbf71ce`: 21 files, 909 insertions / 9 deletions, including the custom-field adapter, tests, all route/command/snapshot changes, validators, events, translations, contract/status and lesson changes. Read the existing acceptance/transaction/context/source/encryption implementation and previous foundation/authorization closure as dependencies. No implementation changes by this reviewer.

Normative references: approved operational App Spec (especially DA01/DA08/DA12, mandatory versions and A02/A03/A16), job-intake spec, shared implementation contract, command foundation review and authorization closure; root, core API/events/custom-field/encryption/RBAC, shared and customers reference guidance, BACKWARD_COMPATIBILITY, local review extension and `.ai/review-checklist.md`. The shared `.agents/skills/om-code-review/SKILL.md` is absent; applied the available local extension/checklist as the implementation contract explicitly permits.

## Required changes

### R1 — major / High: CRUD and acceptance use different guard resource identities

Locations: `apps/mercato/src/modules/logistics/api/jobs/route.ts:31–56`; `api/jobs/[id]/accept/route.ts:19`.

The CRUD factory does not derive its guard resource from `indexer.entityType`. `packages/shared/src/lib/crud/factory.ts:528–536` derives it from events, then command IDs. Here `logistics.jobs.update` becomes **`logistics.job`** through `deriveResourceFromCommandId`; the custom acceptance route uses **`logistics:transport_job`**. `runMutationGuards` matches exact entity identifiers, with no alias normalization between these names. The generated optimistic reader is likewise registered under the factory identity.

Executed counterexample against the actual jobs PUT route and actual factory/registry runner: install an update guard targeting `logistics:transport_job` that returns 423. A valid PUT returns **200**, calls the command bus, and a wildcard observer sees `resourceKind=logistics.job`. The same guard blocks acceptance with **423**, without another command execution. Conversely a factory-key guard does not match the acceptance key. This is a real extension/guard boundary mismatch, not a claim that the domain command's own tenant/version/state checks are absent.

Minimal fix: select and consistently use the platform's canonical guard resource identity across factory routes, custom actions, reader registration and declared guard targets. Preserve entity-index IDs separately where required. Test both directions using the actual factory, including registry and legacy guards, feature-gated guards and callbacks. Do not fix by skipping the factory's guards or hiding the input ID.

### R2 — major / High: an ordinary custom-field addition cannot be redone after undo

Locations: `commands/jobDrafts.ts:86–89,114,125–133`; `lib/jobSnapshot.ts:30–35`.

Counterexample: existing draft has custom `{priority:'normal'}`; update adds scalar `extra:'new'`; undo succeeds. `buildCustomFieldResetMap(before, after)` writes `extra:null`. The real setter preserves a scalar row with null value (`packages/core/src/modules/entities/lib/helpers.ts:182–215`), and the real snapshot loader returns the key with null (`packages/shared/src/lib/crud/custom-fields.ts:683–700`). Redo hashes `{priority:'normal',extra:null}` against the original `{priority:'normal'}`, rejects **409 undoConflict**, and cannot restore the update despite no intervening edit.

Independent command probe reproduced exactly this failure using the existing command fixture, real reset-map/comparison code, and its mock EAV store. Real setter/loader sources confirm that the fixture's null representation is applicable. Existing tests only replace an already-present field and miss this case.

Minimal fix: compare against the actual committed state produced by undo, or define a consistent canonical representation of absent/cleared scalar and multi-value custom fields. Preserve the distinction where it has domain meaning. Cover add/clear/replace, scalar/multi-value, encrypted values and redo→undo cycling with the real adapter.

Related unclosed normalization risk, not claimed as a database-tested failure: the snapshot also hashes raw decimal strings. A probe with unchanged version and weight rehydrated through the installed real MikroORM `DecimalType('string')` from `12.500` rejects undo of a `12.5` create snapshot. `weightSchema` does not canonicalize and the column is numeric(12,3). Verify the actual insert/refresh representation in the parent-owned integration harness and normalize with the existing scaled-decimal helpers before comparing snapshots. This review simulated the database-returned value; it did not execute PostgreSQL.

### R3 — major / High: redo discards the version and overwrites intervening edits

Locations: `commands/jobDrafts.ts:86–89,125–140`.

`undo` checks `snapshots.after.updatedAt`, but `redo` has no expected-version check and `comparable` deliberately removes updatedAt. Executed sequence: draft cargo `Pallets`; edit to `Old edit`; undo to `Pallets`; two subsequent valid `updateJobCommand.execute` calls change cargo to `Intervening edit`, then intentionally back to `Pallets`; redo of the old log succeeds and writes **`Old edit`** over that later decision. All operations use current supplied versions and normal command authorization. The real command bus delegates redo directly to `handler.redo`; it does not add a row-version check (`shared/lib/commands/command-bus.ts:261–267`).

Minimal fix: retain the version/state actually committed by the undo and require that version under the job lock for redo. It cannot simply compare against the old pre-edit version because a legitimate undo advances updatedAt. Keep the existing state/custom-field checks as additional guards. Add both an ordinary successful undo/redo cycle and the intervening ABA edit case; the latter must fail unchanged. Do not make all redo impossible as a workaround.

### R4 — major / High: HTTP optimistic guard blocks a committed identical update retry

Locations: `api/jobs/route.ts:53–55,59–65`; interaction with `shared/lib/crud/factory.ts:2654–2682` and `shared/lib/crud/optimistic-lock.ts:319–387`.

The factory checks the request's `x-om-ext-optimistic-lock-expected-updated-at` against the current row before invoking the receipted command. A successful PUT advances the version, so replaying the identical request/header after a lost response returns **409 before receipt lookup**. This is the standard header that CrudForm automatically supplies. The domain command's correct receipt-first behavior is unreachable on this HTTP path.

Executed the real route, factory, bridged optimistic service and auto-registered generic reader: first request with matching header returns **200**; stubbed command completion advances the row version; the identical retry returns **409**, and the command bus is not called on retry. Auth/scope/DB and the command result are fixtures; this proves the HTTP ordering conflict, not a real receipt transaction. The existing command replay tests do not traverse this factory guard.

Minimal fix: add an authorized, digest-verified committed-replay path before state-dependent mutation checks, while retaining all required guards/version checks for requests that actually mutate. Keep changed-body/request-ID reuse rejection and current permission checks. Do not globally disable optimistic locking or exempt all matching request IDs. Receipt GET currently provides an alternate recovery path, but does not satisfy the explicit identical-request replay contract. Test a real committed retry with the standard header, changed input, revoked access and uncommitted/stale requests.

## Other examined behavior

- Fresh ACL/null-scope closure remains present. The command helper clears stale incoming superadmin claims before the real fresh directory resolution, requires selected tenant/organization and uses the feature policy. Receipt reads/replays use it; API-key actors remain intentionally excluded. The focused suite reruns the real resolver regression tests. No new cross-tenant or ACL bypass established.
- Public body schemas reject scope/state/snapshot fields and require request IDs plus existing-record versions. The factory mapInput leaves the update `id` at the top level, so the documented null-ID guard opt-out is not used. Acceptance reparses guard-modified input and disallows changing route ID/request ID. Registry and bridged legacy guards are collected by the real route helper; R1 concerns inconsistent target identity.
- GET requires fresh authorization before factory invocation and again in buildFilters, scopes tenant and organization, caps page size at 100 and disables cache. Factory query-engine/decorator behavior was inspected, not exercised through a live authenticated HTTP session. Receipt query is a strict action allowlist, keyed by actor/action/request/scope; public outcomes contain IDs and committed versions rather than undo data.
- State and receipt still share the outer `withAtomicFlush` transaction, advisory receipt lock and refreshed scoped job lock. Caller-owned transactions are rejected. Scalar flush precedes custom-field queries; adapter passes the same EM into real sanitation/validation/setter helpers, which join the ambient transaction. Before/after custom snapshots are inside the owning job lock. No new forked snapshot read or premature adapter commit was found. This is source/control-flow evidence, not concurrent PostgreSQL proof.
- Create undo soft-deletes, redo restores the same ID; draft/state/history markers gate both. Update/undo enforce mandatory versions independently of global optimistic-lock opt-out. R2/R3 remain failures in otherwise guarded undo/redo.
- Snapshot symbols stay out of JSON receipts; buildLog transfers them into action-log snapshot/payload fields. The real audit-log encryption map covers command payload, before/after snapshots and inferred changes. Job encryption maps cover customer/cargo/place/notes. Real query-index document construction calls `encryptIndexDocForStorage` and fails closed on encryption exceptions; no bespoke plaintext PII search indexing added here. Runtime encryption/index propagation was not verified end to end.
- Domain events carry minimal IDs/scope/versions and run after outer commit. Receipt replay skips duplicate draft undo-log generation. Telemetry catches module postcommit failure without alleging transaction rollback. Existing platform limitations about swallowed downstream effects/durable recovery from the foundation review still apply.
- The source changes are additive and app-module-local apart from supporting docs/lesson refinements. No production dependencies, schema changes, platform implementation edits or removed contract surfaces occur in this slice. Translations cover the five existing locales. New auto-discovered routes/events still require parent generation/build/integration verification.

## Independent executed evidence

Runner: **local**. `DOCKER_COMPOSE_FILE` unset; no local dev-compose candidates; dev compose probe found no running app; fullapp compose probe failed interpolation for absent `JWT_SECRET`. No credential values were read or supplied. No runtime was started/stopped.

1. Normal app Jest config with both setup lists unchanged, absolute app root, parent node_modules lookup and explicit logistics discovery: **11 suites / 294 tests passed**, exit 0 (5.881s).

```powershell
$env:NODE_PATH='C:/Dev/open-logistic/.ai/cezar/worktrees/32c60056-a2a7-4922-a033-3ea531273fc1/node_modules'
node -e "const path=require('path');const config=require('./apps/mercato/jest.config.cjs');config.rootDir=path.resolve('apps/mercato');config.testMatch=['**/src/modules/logistics/__tests__/**/*.test.ts','**/src/modules/logistics/__tests__/**/*.test.tsx'];config.modulePaths=[process.env.NODE_PATH];require('jest').runCLI({config:JSON.stringify(config),runInBand:true},[process.cwd()]).then(r=>process.exit(r.results.success?0:1))"
```

2. Adversarial probes used the same normal config/setup, `cache:false`, and an external temporary transformer which only appended test text to the existing test modules before delegating to `scripts/jest-mikroorm-transformer.cjs`. No tracked test or implementation file was edited. Files retained in `%TEMP%/logistics-d70af0ac-review/`: `probes.ts`, `transformer.cjs`, `route-probes.ts`, `route-transformer.cjs`. Command probe run: **1 suite / 16 tests passed**, including three added counterexamples. Route probe run: **1 suite / 22 tests passed**, including two added counterexamples. These probes deliberately assert the observed defective behavior; a green probe is evidence of a finding, not a correctness claim.
3. Probe specifics: R2 uses original draft fixture + actual handlers/reset map; R3 uses three actual update executions plus undo/redo with mock EM storage; decimal risk uses actual installed DecimalType conversion of a supplied database-shaped string. R1/R4 import the real jobs route/factory/registry and optimistic service/reader, with fake authenticated scope, RBAC, EM and command bus. All normal app setup files remain enabled. The first route probe attempt failed because the new fixture lacked `em`; registered mock EM/dataEngine and reran successfully. This harness failure is not a product finding.
4. `git diff --check 2027f0d4f..75cbf71ce` passed. Fork-point-to-parent diff remained empty at the final reviewed-tip check. Review-note diff checked before commit.

## Limits and disposition

No live HTTP session, database transaction/concurrency/rollback, real ORM encryption round trip, generated registry build, browser, typecheck or full release gate was independently run. Parent's reported typecheck/scoped compiler pass is not substituted for independent evidence. The parent's integration harness is parent-owned and was untouched. The mock suites do not prove database serialization or normalized persistence; the extra decimal probe explicitly leaves that integration question open.

Fix R1–R4 and add focused regressions before approving this slice. Trips, UI, cancellation and promise implementation are intentionally outside this slice and are not findings. **This review never declares the operational release ready.** Only this review note is committed; temporary probe files and tree notes are outside the repository. No migration, credentials, push, base-branch merge or implementation edit performed.
