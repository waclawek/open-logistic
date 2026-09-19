# Logistics job-intake R1–R4 closure review

Date: 2026-09-19. Verdict: **approve — R1–R4 slice only**.

Reviewed `cez/32c60056` at **72811218c50d6dc94c62da9f0355d50a2cdd82aa**, independently inspecting `5a06b7401..72811218c`: 15 files, 334 insertions / 24 deletions. This worktree began at that exact tip. No residual blocker established in the four requested fixes. This is not operational-release approval.

References: tree brief, approved operational App Spec (receipt/version, DA01/DA08/DA12 and A02/A03/A16 obligations), job-intake spec, shared implementation contract, previous `logistics-job-intake-implementation-review.md`, root/core/shared/customers reference guidance, spec/QA rules, concurrency documentation, BACKWARD_COMPATIBILITY and relevant undo/authorization lessons. Applied `.ai/skills/om-code-review/SKILL.md` and the approved `.ai/review-checklist.md` fallback; the shared `.agents/skills/om-code-review/SKILL.md` is absent. Review covers route, command, helper, test and supporting documentation layers; source remained read-only.

## Closure evidence

### R1 — closed: canonical guard identity

`api/jobs/[id]/accept/route.ts:26` and both command log builders now use `logistics.job`. The real factory derives this same resource from `logistics.jobs.create/update` (`packages/shared/src/lib/crud/factory.ts:517–537`), and registers its generic optimistic reader under that resource (`:1080–1102`). The registry matches exact/dotted wildcard identities, without colon aliases. Index/custom-field identity correctly remains `logistics:transport_job`.

The normal suite exercises the actual CRUD factory and action wrapper: a feature-gated `logistics.job` registry guard blocks both PUT and acceptance with 423; bridged legacy guards see the same identity and also block both. Command execution remains absent on rejection. Successful transformed requests run their requested callbacks; committed replay does not run them again. Update input retains its top-level ID, so it does not use the factory's null-ID guard opt-out.

### R2 — closed: canonical cleared snapshots and decimal scale

`lib/jobSnapshot.ts:16–37` formats both applied and captured weight using exact scaled integers at three decimal places. Captured custom snapshots consistently omit undefined, null and empty arrays. Nonempty arrays, false, zero and empty strings are not erased. This matches the approved cleared-field contract and avoids equality failures from persisted null scalar rows or cleared multi-value rows.

Checked the real reset-map helper, EAV setter and snapshot loader: `shared/lib/commands/customFieldSnapshots.ts`, `core/modules/entities/lib/helpers.ts:182–215`, and `shared/lib/crud/custom-fields.ts:683–700`. The new real-adapter suite uses actual sanitation/setter/snapshot/encryption code with an in-memory EntityManager and fake encryption key provider. It round-trips scalar additions/clears and multi-value replacements/clears twice with encryption enabled and disabled; the adapter does not begin/commit a transaction of its own. Command regressions cover these operations through repeated undo/redo and `12.5` versus `12.500` storage representation. No PostgreSQL round trip is claimed.

### R3 — closed: committed undo version and repeated cycles

Undo uses the original action-log UUID as its receipt request ID (`commands/jobDrafts.ts:105`); receipt/state are committed by the existing outer transaction. Redo locks the scoped job, locates that log's committed undo receipt/result, and requires the result's actual `recordUpdatedAt` before applying the snapshot (`:136–148`). Missing receipt, stale version, wrong scope, incompatible draft/deletion state and changed snapshot fail closed. Canonical comparison still excludes the old snapshot version, but no longer substitutes for an actual version check.

Inspected the actual command bus and audit routes/services: the bus atomically claims undo through the log service, passes the original log into undo/redo, builds a new log from the redo result, and generates a fresh undo token (`shared/lib/commands/command-bus.ts:261–325,356–425,631–634`). The redo route supplies the original undone log and marks it redone (`core/modules/audit_logs/api/audit-logs/actions/redo/route.ts:136–142`). Therefore a subsequent cycle uses the new log UUID rather than reusing the first undo receipt. The redo receipt lookup is scoped to tenant/organization and the trusted log UUID, intentionally allowing an authorized audit actor different from the undo actor; public receipt reads remain actor-scoped.

Existing ABA regression executes two valid later edits returning to the undone values; redo rejects 409 without changing the later version. Independent probes used the actual CommandBus with a fixture action-log service and completed three undo/redo cycles for both create and update, asserting distinct action-log IDs and matching undo receipts. This independently checks bus envelope/log generation rather than assuming the hand-built log fixture matches production. The log-service database compare-and-set was inspected, not executed against a database.

### R4 — closed: authorized original-request replay

`api/jobs/route.ts:64–89` freshly authorizes, validates the original body/custom fields, and looks up the actor/action/scope/request-ID receipt with its digest before the factory's state-dependent guard. Changed-body reuse fails 409. Requests without a receipt enter the ordinary factory, including optimistic/registry/legacy guards and command validation. A factory 409 triggers a fresh authorized digest-checked receipt lookup; an absent receipt preserves the original conflict. Acceptance uses the same authorized digest preflight (`api/jobs/[id]/accept/route.ts:18–33`).

`lib/receiptRequest.ts` stores original identity only as a non-enumerable symbol on the server Request and removes it in `finally`. The factory's `withCtx` preserves that Request (`shared/lib/crud/factory.ts:1516`); API/guard/command transformations modify input, not the envelope. `commands/transaction.ts:63–67` rejects changed action, request ID or record ID and uses the original digest. Direct commands without an envelope still hash their validated input. A header or JSON key does not become a JavaScript symbol property.

Normal regressions run real factory/optimistic-reader/command paths with fixture scope and database: unchanged PUT retry with the stale standard header returns the original receipt; changed body and new stale requests fail; revocation denies replay; identity redirects fail; POST/PUT guard transformations replay successfully; symbol cleanup occurs; a modeled intervening commit is recovered on conflict. Independent probes additionally verify:

- Actual CommandBus beforeExecute transformation persists its value, while original HTTP input replays successfully and the interceptor runs once.
- Client-supplied receipt/digest-looking headers cannot replay changed input or bypass a blocking guard for a new request.
- Revoking write authority during the modeled concurrent commit causes the final conflict receipt recheck to return 403, rather than disclosing the receipt.

This establishes the intended committed-result path, not a general guard exemption: replay performs no new state mutation; fresh requests retain all mutation checks. Actual transactional serialization/concurrent PostgreSQL behavior remains a release integration obligation.

## Independent executed validation

Runner: **local**. `DOCKER_COMPOSE_FILE` unset; no local dev-compose candidates; `compose.fullapp.dev.yml` probe returned no running app. `compose.fullapp.yml` probe failed interpolation because JWT_SECRET was absent. No secret was read/supplied, and no runtime was started/stopped.

1. Normal app Jest config, unchanged setupFiles/setupFilesAfterEnv, explicit logistics discovery, parent dependency lookup: **12 suites / 310 tests passed**, exit 0, 6.921 seconds.

```powershell
$env:NODE_PATH='C:/Dev/open-logistic/.ai/cezar/worktrees/32c60056-a2a7-4922-a033-3ea531273fc1/node_modules'
node -e "const path=require('path');const config=require('./apps/mercato/jest.config.cjs');config.rootDir=path.resolve('apps/mercato');config.testMatch=['**/src/modules/logistics/__tests__/**/*.test.ts','**/src/modules/logistics/__tests__/**/*.test.tsx'];config.modulePaths=[process.env.NODE_PATH];require('jest').runCLI({config:JSON.stringify(config),runInBand:true},[process.cwd()]).then(r=>process.exit(r.results.success?0:1))"
```

2. Five independent appended probes plus the unchanged jobDrafts suite: **1 suite / 32 tests passed**, exit 0, 3.177 seconds. External files retained at `%TEMP%/logistics-193dca17-review/{probes.ts,transformer.cjs}`. The transformer appends probes in memory only to jobDrafts.test.ts and delegates to the repository transformer. Same normal app setup; runInBand, cache false; no tracked source/test edits. CommandBus is real; persistence/ACL/action-log service are fixtures. No database concurrency claim.

3. Independently ran `node scripts/typecheck.mjs --incremental false` from the parent `apps/mercato` directory: **exit 0, no diagnostics**. Parent worktree was clean and HEAD was the exact reviewed tip before execution; its installed dependencies/generated files were used. `--incremental false` avoids writing a build-info file. Normal app typecheck excludes unit tests. The parent's separate strict all-logistics-tests/TC-LOG-008 compiler result is reported parent evidence, not independently rerun here.

4. `git diff --check 5a06b7401..72811218c` passed. All 15 changed files inspected; no schema, production dependency, platform implementation or unrelated module change in the closure delta. Supporting spec/contract/lesson changes describe these same fixes. TC-LOG-008 adds the standard PUT header, exact retry and changed-body rejection assertions; it was inspected, not executed.

## Limits and disposition

Approve R1–R4 closure at the exact tip above. No additional required source change from this review. The reviewed implementation and tests support this bounded approval; they do not establish live HTTP/database/browser operation, PostgreSQL lock/rollback races, production encryption/index delivery, or full release readiness. No integration runtime, migration, full monorepo gate, browser or deployment was run. Cancel/promise, job UI, trips and remaining operational release coverage remain parent-owned unfinished scope and are not defects added to this closure review.

Only this review note is committed. No source changes, migrations, credentials, shared/base-branch writes, pushes or CLI repair work were performed.
