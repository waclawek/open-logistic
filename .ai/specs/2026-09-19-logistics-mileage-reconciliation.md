# Fleet mileage reconciliation

Status: DESIGN CANDIDATE — 2026-09-19.

## TLDR

Reconcile every vehicle-day and compare fixed-cohort empty-kilometre shares, including non-trip movement.

Source of truth: [user-confirmed operational App Spec](2026-09-19-app-spec-logistics-operations.md). Trace: US12-US14; C17-C20; A10-A13; LOG-OP-12-14.

## Confirmed design decisions

The user approved the complete App Spec on 2026-09-19. Placement is the existing app-level logistics module; no platform rewrite. Capabilities are split into five feature specifications, as required by the approved handoff; all remain behind one complete operational release gate. No new critical business or placement question is open.

## Overview / Problem Statement

The navigation foundation has no operational persistence. Non-trip ledger/day reconciliation functions without trip execution. Full release integrates trip facts within their command transaction.

## Proposed Solution / Architecture

Apply the [shared implementation contract](app-spec-notes/logistics-implementation-contract.md) and every App Spec refinement. Exact tenths of km; incoming leg uses custody before destination. Missing evidence never invents distance. No time/odometer overlap; E+L+U=T for complete days. Unknown cargo can reconcile distance but not improvement. No midnight prorating; DST/reset/gaps remain incomplete. Corrections invalidate day reviews and comparison. Relative reduction also requires positive baseline empty share.

## Data Models

MileageLeg, VehicleDay, MileageLedgerSettings and MeasurementCohort use exact approved definitions. Per-vehicle ledger revision guards writes/reconciliation. Frozen cohort and timezone cannot be silently edited; all days remain accounted for.

Common scope/version, encryption, exact decimals, indexing and immutable history follow the shared contract; no opaque payloads or cross-module ORM.

## API Contracts

A10 legs GET/POST and A09 mileage leg correct; A11 days GET/POST/PUT/reconcile; A12 cohorts/settings/freeze; A13 statistics GET. Use approved mileage/measurement/correction grants, requestId and appropriate ledger/day/cohort version. Stats exposes decimal E/L/U/T, coverage/missing days, valid shares/N-A reasons, relative result and frozen cohort/revision time.

Shared contract defines responses/errors, guard protocol, versions, receipts, custom fields and authorization.

## File Manifest / UI / Frontend Architecture

lib/mileage.ts; commands/mileage.ts, measurement.ts; services/mileageLedger.ts; A09-A13 routes; components/mileage/MileageList.tsx (table), LegForm.tsx, DayReview.tsx, CohortForm.tsx (forms), StatisticsView.tsx (filters); statistics/mileage server wrappers.

Each named client leaf owns the stated browser state, remains <=300 lines and uses shared forms/tables/dialog primitives. No client page roots/global providers/heavy root imports. Stable entity and extension handles, five locales, keyboard submission/cancel, conflict UI and hydration evidence are required.

## Commands / Undo / Events / Cache

Registered commands and shared transaction/receipt protocol cover every write. Guarded snapshot undo only for safe drafts; physical actions compensate/correct. Singular past-tense events emit after outer commit; indexes/list aliases invalidate on writes/undo. Sources/board/statistics are no-store reads.

## Implementation Plan

Exact rules and non-trip ledger → synchronous trip boundaries/corrections/day review → immutable cohort/comparison → manager UI and integrations.

## Integration Coverage

LOG-OP-12..14: workshop/positioning/no-job/no-motion, unknown load, gaps/overlap/reset/midnight/DST, corrections, disabled frozen vehicles, 25%→22.5%=10%relative, worsening, zero-distance and zero-baseline N-A, scope/conflicts.

Create/clean own fixtures; cover each method/path and changed interactive route. Full ordered repository gate remains required.

## Migration & Backward Compatibility

Additive schema/routes/features only; preserve thirteen platform surfaces and seven navigation contracts. Generate scoped migrations/snapshot; no developer/production migration without authorization. Rollback preserves facts/in-flight completion.

## Risks & Impact Review

High: incomplete mileage falsely appears improved; explicit evidence/coverage and frozen denominators suppress the claim. Manual boundary evidence burden remains visible without blocking physical execution.

All write paths also risk duplicate outcomes, cross-scope references and stale clients (High; owning records/API/UI). Shared guards, scoped references, versions and atomic receipts mitigate these. Optional-source failure blocks new eligibility decisions while historical execution stays usable.

## Final Compliance Report — 2026-09-19

Guides: root/core/customers/shared/UI/backend/QA and shared contract references. Canonical primitives, encryption, scoped locked writes, additive contracts and frontend budgets specified. Data/API/UI/coverage maps to the owning App Spec stories. Runtime compliance unverified. Fresh scope review and readiness findings pending; resolve design blockers before coding.

## Implementation Status

Not started.

## Changelog

### 2026-09-19
- Expanded skeleton from approved decisions into capability-specific design and shared contract.
