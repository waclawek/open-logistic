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

In progress. Strict input/version/decimal validation, job entity/encryption/schema constraints, and receipted acceptance command are authored. Acceptance has unit coverage for scoped current authorization, mandatory versions, atomic state/receipt rollback, replay and postcommit failure. Create/edit/cancel/promise commands, API, job UI and end-to-end coverage remain outstanding. Scoped migrations/snapshot were generated offline from ORM metadata after normal db:generate failed local PostgreSQL authentication; no migration was applied.

## Changelog

### 2026-09-19
- Expanded skeleton from approved decisions into capability-specific design and shared contract.

- F4 resolved: unassigned promise route/command/UI explicitly owned here; assigned revisions delegate to trip replan. Initial validator/decimal foundation implemented, 31 new tests passed; persistence/API/UI not started.
