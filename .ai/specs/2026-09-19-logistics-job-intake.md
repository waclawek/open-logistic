# Transport job intake

Status: DESIGN CANDIDATE — 2026-09-19.

## TLDR

Accept complete customer work into a ready queue without requiring available vehicles.

Source of truth: [user-confirmed operational App Spec](2026-09-19-app-spec-logistics-operations.md). Trace: US02; C04-C05; A02/A03; LOG-OP-02/14.

## Confirmed design decisions

The user approved the complete App Spec on 2026-09-19. Placement is the existing app-level logistics module; no platform rewrite. Capabilities are split into seven feature specifications, as required by the approved handoff; all remain behind one complete operational release gate. No new critical business or placement question is open.

## Overview / Problem Statement

The navigation foundation has no operational persistence. Job acceptance works without fleet/trips; assignment after confirmation belongs to trip commands.

## Proposed Solution / Architecture

Apply the [shared implementation contract](app-spec-notes/logistics-implementation-contract.md) and every App Spec refinement. Positive weight and known positive pallet count when palletized; valid UTC windows and explicit timezone entry. Acceptance stamps once. Identical request replays; acknowledged repeated customerReference may represent separate work. No arbitrary status or assigned/onboard CRUD edits.

## Data Models

TransportJob uses exact approved fields, decimal weight, palletized flag and immutable accepted windows/customer/place snapshots. PromiseRevision on an unassigned ready job belongs to commands/jobs.ts; assigned promise changes delegate to atomic trip replanning. Complete draft remains unaccepted.

Common scope/version, encryption, exact decimals, indexing and immutable history follow the shared contract; no opaque payloads or cross-module ORM.

## API Contracts

A02 jobs GET/POST/PUT; A03 jobs/[id]/accept, cancel and promise POST. Writes require logistics.jobs.manage; reads logistics.view. Writable fields are customerId/reference, cargo, weight/pallet data, pickup/delivery Places/windows and notes. Accept/cancel uses requestId/version and reason. Assigned cancel delegates to trip logic with its additional grants/versions.

POST jobs/[id]/promise accepts the full replacement pickup/delivery windows, reason, agreedWith/agreedAt, requestId and expected job version. Ready job without a trip requires only jobs.manage plus view; assigned job additionally requires dispatch.manage and expected trip/job/plan versions and delegates to the trip transaction. JobDetail owns the agreement action; original accepted windows remain unchanged. Test both unassigned-only and assigned permission/version cases.

Shared contract defines responses/errors, guard protocol, versions, receipts, custom fields and authorization.

## File Manifest / UI / Frontend Architecture

commands/jobs.ts; jobs API/action routes; components/jobs/JobList.tsx (table), JobForm.tsx (form), JobDetail.tsx (actions/receipt recovery); transport-jobs create/detail server wrappers.

Each named client leaf owns the stated browser state, remains <=300 lines and uses shared forms/tables/dialog primitives. No client page roots/global providers/heavy root imports. Stable entity and extension handles, five locales, keyboard submission/cancel, conflict UI and hydration evidence are required.

## Commands / Undo / Events / Cache

Registered commands and shared transaction/receipt protocol cover every write. Guarded snapshot undo only for safe drafts; physical actions compensate/correct. Singular past-tense events emit after outer commit; indexes/list aliases invalidate on writes/undo. Sources/board/statistics are no-store reads.

## Implementation Plan

Job entity/encryption/validated CRUD and receipts → acceptance/cancellation and undo guards → entry/ready queue/detail with integrations.

## Integration Coverage

LOG-OP-02/14: accept without free truck, invalid cargo/windows, scoped customer, exact/wildcard/read-only, optimistic conflict, duplicate/lost response, assigned edit denial and five-locale form hydration.

Create/clean own fixtures; cover each method/path and changed interactive route. Full ordered repository gate remains required.

## Migration & Backward Compatibility

Additive schema/routes/features only; preserve thirteen platform surfaces and seven navigation contracts. Generate scoped migrations/snapshot; no developer/production migration without authorization. Rollback preserves facts/in-flight completion.

## Risks & Impact Review

High: forged state or cross-scope customer corrupts work; strict writable fields and scoped source validation prevent it. Source disappearance later preserves historical snapshots.

All write paths also risk duplicate outcomes, cross-scope references and stale clients (High; owning records/API/UI). Shared guards, scoped references, versions and atomic receipts mitigate these. Optional-source failure blocks new eligibility decisions while historical execution stays usable.

## Final Compliance Report — 2026-09-19

Guides: root/core/customers/shared/UI/backend/QA and shared contract references. Canonical primitives, encryption, scoped locked writes, additive contracts and frontend budgets specified. Data/API/UI/coverage maps to the owning App Spec stories. Runtime compliance unverified. Fresh scope review and readiness findings pending; resolve design blockers before coding.

## Implementation Status

In progress. Authored strict input/version/decimal validation, job entity/encryption/schema constraints, receipted acceptance and draft create/edit commands with guarded snapshot undo/redo and same-transaction custom fields. Added factory GET/POST/PUT jobs, guarded acceptance action and actor/action-scoped receipt lookup. Route/control-flow coverage includes current authorization, protected fields, mandatory versions, rollback, replay, guard transformations, postcommit effects and safe undo. Latest local logistics suite: 310 tests across 12 suites; scoped strict compiler: zero diagnostics; app typecheck passed. These are isolated tests, not HTTP/database/browser verification. Cancel/promise commands, job UI and end-to-end coverage remain outstanding. The repaired managed launcher now reaches application readiness and runs the HTTP scenarios. The first run exposed a fixture authentication issue: production Secure cookies were omitted over local HTTP. The API fixture now supplies the real login-issued bearer token while preserving selected-organization cookies; the rerun is pending. No HTTP/database assertions are claimed passed yet. No developer database migrations were applied.
## Changelog

### 2026-09-19
- Expanded skeleton from approved decisions into capability-specific design and shared contract.

- F4 resolved: unassigned promise route/command/UI explicitly owned here; assigned revisions delegate to trip replan. Initial validator/decimal foundation implemented, 31 new tests passed; persistence/API/UI not started.

Integration authoring: `TC-LOG-008-job-intake.spec.ts` adds API-created scoped fixtures for draft create/edit/list, stale versions, concurrent identical acceptance, receipt recovery, protected input, null selection and revoked write access. It is restricted to the managed ephemeral runner; receipts/accepted facts are cleaned with its disposable database. Scoped strict compilation passes. Playwright discovery passed: two tests in one file. Execution remains blocked by managed server startup. The PUT test now sends the standard optimistic-lock header and covers identical replay plus changed-body rejection.

Intake review R1-R4 fixes authored: unified guard resource, canonical custom/decimal snapshots, redo checked against committed undo version, and authorized HTTP receipt recovery ahead of state-dependent guards. Real-factory and real-adapter/mock-database regressions pass; independent closure review remains required. No live PostgreSQL/HTTP correctness claimed.

- Added a third TC-LOG-008 HTTP scenario for persisted 12.5-weight create undo/redo cycles and intervening ABA edits. Strict integration compilation passes; execution remains pending managed runtime readiness. R1-R4 independent closure is approved in app-spec-notes/logistics-job-intake-closure.md; runtime verification is still required.

### 2026-09-19 — operational HTTP and cancellation increment

Managed TC-LOG-008 passed all three scenarios against the isolated PostgreSQL runtime: draft create/edit/replay, concurrent acceptance and receipt lookup, current permission revocation, persisted decimal undo/redo cycles, and rejection of intervening ABA edits. This run predates the final encoded-whitespace scope normalization fix; final-tip verification remains required.

Added unassigned draft/ready cancellation with required reason, mandatory job version, terminal timestamp, atomic state/receipt, current authorization, safe retry, encrypted platform command-audit payload and postcommit event/index effects. Generic undo is disabled. Assigned-job cancellation remains reserved for the later coupled trip implementation, which must close membership and unperformed stops atomically; no direct status shortcut is exposed. Added guarded POST jobs/[id]/cancel and cancellation receipt lookup, five locale messages, and HTTP scenarios for both draft and ready cancellation. Promise revision, assigned cancellation and all job UI remain outstanding. Unit suite:402 tests/14 suites; app and full logistics source/test/integration strict checks passed; generation completed. Expanded HTTP run and independent review are pending.

Cancellation durability refinement: store encrypted, command-owned `TransportJob.cancellationReason` with status, terminal timestamp and receipt in the same database transaction. Generic input cannot set it. Scoped job reads expose the decrypted reason; public command results and events omit it. Platform audit metadata remains secondary: audit failure and identical retry cannot erase the retained reason. Additive nullable-column migration preserves existing records. Real CommandBus failure/retry regression verifies this boundary.

Validation update: managed TC-LOG-008 run against 0900601af passed all three scenarios, including encoded-whitespace organization rejection and draft/ready cancellation. Subsequent reason-durability fix passes 404 tests/14 suites, normal app typecheck, strict logistics source/test/integration compilation, generation and offline migration/snapshot consistency. The added persisted-reason HTTP assertion requires a fresh managed run; no final-tip runtime claim.
