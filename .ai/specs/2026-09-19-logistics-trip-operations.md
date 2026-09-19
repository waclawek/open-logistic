# Manual trip operations

Status: DESIGN CANDIDATE — 2026-09-19.

## TLDR

Plan, reserve, execute and recover one whole-job transport journey with truthful custody.

Source of truth: [user-confirmed operational App Spec](2026-09-19-app-spec-logistics-operations.md). Trace: US03-US10; C06-C15; A04-A08/A16; LOG-OP-03-11/14.

## Confirmed design decisions

The user approved the complete App Spec on 2026-09-19. Placement is the existing app-level logistics module; no platform rewrite. Capabilities are split into seven feature specifications, as required by the approved handoff; all remain behind one complete operational release gate. No new critical business or placement question is open.

## Overview / Problem Statement

The navigation foundation has no operational persistence. Planning/execution/recovery form one custody lifecycle. Consumes fleet eligibility and ready jobs; mileage receives committed fact boundaries synchronously.

## Proposed Solution / Architecture

Apply the [shared implementation contract](app-spec-notes/logistics-implementation-contract.md) and every App Spec refinement. Drafts never reserve. Confirmation locks resource/job anchors; start revalidates eligibility/occupancy. Pickup creates whole-job custody; delivery/return ends it even without odometer. Finish/interruption settles every active obligation. Retries preserve failed attempts/promises. Handover atomically starts receiver and transfers all selected jobs, with same-driver release/reacquire. Source change GET only derives warning. Corrections reject branches/downstream contradiction; no generic physical undo.

## Data Models

Trip, stops, membership, Assignment, OperationalFact, Disruption, PromiseRevision, PlanRevision, SourceObservation, RecoveryHandover, ResourceRelease and CommandReceipt use all App Spec refinements. Unique effective correction successors and source fingerprints back guards.

Common scope/version, encryption, exact decimals, indexing and immutable history follow the shared contract; no opaque payloads or cross-module ORM.

## API Contracts

A04 draft CRUD; A05 confirmation/replan/unassign/cancel/release-job; A06 execution; A07 handover/interruption/releases; A08 disruptions including explicit source-change command; A09 is owned by the report-correction specification; A16 outcome GET. Typed action inputs carry expected trip version/revisions; handover additionally target/job versions, selected jobs, resources/time/place/readings/evidence. App Spec per-action feature combinations remain mandatory.

Shared contract defines responses/errors, guard protocol, versions, receipts, custom fields and authorization.

## File Manifest / UI / Frontend Architecture

commands/trips.ts, execution.ts, recovery.ts, disruptions.ts; services/operations.ts; lib/planning.ts, custody.ts; typed A04-A09/A16 routes; components/trips/TripList.tsx (table), TripPlanForm.tsx (ordered inputs), TripDetail.tsx (actions/history), StopActionDialog.tsx, RecoveryDialog.tsx (typed dialogs); disruptions list client leaf.

Each named client leaf owns the stated browser state, remains <=300 lines and uses shared forms/tables/dialog primitives. No client page roots/global providers/heavy root imports. Stable entity and extension handles, five locales, keyboard submission/cancel, conflict UI and hydration evidence are required.

## Commands / Undo / Events / Cache

Registered commands and shared transaction/receipt protocol cover every write. Guarded snapshot undo only for safe drafts; physical actions compensate/correct. Singular past-tense events emit after outer commit; indexes/list aliases invalidate on writes/undo. Sources/board/statistics are no-store reads.

## Implementation Plan

Draft plan/revision model and load UI → transactional reservations/receipts/replan → execution/retry/recovery → authorized history/actions and full race/failure integrations.

## Integration Coverage

LOG-OP-03..11/14 and DA02-08: competing reservation/job requests, failed replan rollback, active overrun, missing reading finish, A-onboard/B-unpicked interruption, two-job handover rollback, source outage, read-only warnings, fingerprint dedup, correction branching and lost/revoked replay.

Create/clean own fixtures; cover each method/path and changed interactive route. Full ordered repository gate remains required.

## Migration & Backward Compatibility

Additive schema/routes/features only; preserve thirteen platform surfaces and seven navigation contracts. Generate scoped migrations/snapshot; no developer/production migration without authorization. Rollback preserves facts/in-flight completion.

## Risks & Impact Review

Critical: partial custody/reservation can lose cargo or double dispatch; canonical locks, uniqueness and outer atomic receipt/state protect it. Postcommit event failure may delay projections but never alter physical truth.

All write paths also risk duplicate outcomes, cross-scope references and stale clients (High; owning records/API/UI). Shared guards, scoped references, versions and atomic receipts mitigate these. Optional-source failure blocks new eligibility decisions while historical execution stays usable.

## Final Compliance Report — 2026-09-19

Guides: root/core/customers/shared/UI/backend/QA and shared contract references. Canonical primitives, encryption, scoped locked writes, additive contracts and frontend budgets specified. Data/API/UI/coverage maps to the owning App Spec stories. Runtime compliance unverified. Fresh scope review and readiness findings pending; resolve design blockers before coding.

## Implementation Status

Not started.

## Changelog

### 2026-09-19
- Expanded skeleton from approved decisions into capability-specific design and shared contract.

## Correction capability boundary

[Report correction](2026-09-19-logistics-report-correction.md) owns C16/A09/US11, its manager UI and successor commands. This spec supplies immutable facts, stream revisions and consequence-validation seam; it does not implement correction commands. Shared physical invariants cited above constrain that consumer. Both capabilities remain required before the single pilot release.
