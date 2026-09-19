# Fleet readiness

Status: DESIGN CANDIDATE — 2026-09-19.

## TLDR

Maintain dispatch profiles and evaluate authorized source availability without reserving transport work.

Source of truth: [user-confirmed operational App Spec](2026-09-19-app-spec-logistics-operations.md). Trace: US01; C01-C03/C09; A01/A15; LOG-OP-01/14.

## Confirmed design decisions

The user approved the complete App Spec on 2026-09-19. Placement is the existing app-level logistics module; no platform rewrite. Capabilities are split into seven feature specifications, as required by the approved handoff; all remain behind one complete operational release gate. No new critical business or placement question is open.

## Overview / Problem Statement

The navigation foundation has no operational persistence. Profiles and availability evaluation function without trips; they reserve nothing. Consumers use the source-observation contract.

## Proposed Solution / Architecture

Apply the [shared implementation contract](app-spec-notes/logistics-implementation-contract.md) and every App Spec refinement. Custom subject rules override linked rulesets. Strictly validate all selected rules before existing planner service: zero-second UTC DTSTART, supported daily/weekly clauses, integral-minute duration, whole-day one-offs, no one-off EXDATE, no one-off plus recurring midnight crossing. Include the approved seconds/exact-midnight fixtures. Profile disable retains history.

## Data Models

VehicleProfile and DriverProfile retain exact App Spec fields. EligibilityResult is transient: result, checkedAt, rangeStart/End, source versions, complete selected rules and fingerprint, without stored id or required tripId. A15 performs zero writes even when no trip exists. Only the owning trip command attaches its real tripId and persists a SourceObservation inside its transaction, using the App Spec record fields. Registration normalization/hash is unique per scope; profile rows are lock anchors. Source observations include complete rule membership and versions.

Common scope/version, encryption, exact decimals, indexing and immutable history follow the shared contract; no opaque payloads or cross-module ORM.

## API Contracts

A01 vehicle-profiles/driver-profiles GET/POST/PUT; A15 dispatch-options GET. Profile writes require logistics.fleet.manage; source reads require the relevant master grants plus logistics.view. Selector inputs: UTC range and optional profile IDs. Output: minimal candidates, eligible/ineligible/unknown, checkedAt, fingerprint and interval coverage. Partial pagination never means complete availability.

Shared contract defines responses/errors, guard protocol, versions, receipts, custom fields and authorization.

## File Manifest / UI / Frontend Architecture

commands/profiles.ts; lib/availability.ts; services/sourceAvailability.ts; profile and dispatch-options API routes; components/fleet/FleetList.tsx (filters/table), ProfileForm.tsx (form state). Server route wrappers own navigation.

Each named client leaf owns the stated browser state, remains <=300 lines and uses shared forms/tables/dialog primitives. No client page roots/global providers/heavy root imports. Stable entity and extension handles, five locales, keyboard submission/cancel, conflict UI and hydration evidence are required.

## Commands / Undo / Events / Cache

Registered commands and shared transaction/receipt protocol cover every write. Guarded snapshot undo only for safe drafts; physical actions compensate/correct. Singular past-tense events emit after outer commit; indexes/list aliases invalidate on writes/undo. Sources/board/statistics are no-store reads.

## Implementation Plan

Profile entities/encryption/migration and CRUD with guarded undo → tested source adapter → fleet UI and source failure guidance.

## Integration Coverage

LOG-OP-01/14: duplicates, source absence/grants/cross-scope IDs, pagination, custom precedence, malformed blockers, EXDATE/overnight/seconds hazards, exact-midnight positive case, conflict/disabled/read-only UI.

Create/clean own fixtures; cover each method/path and changed interactive route. Full ordered repository gate remains required.

## Migration & Backward Compatibility

Additive schema/routes/features only; preserve thirteen platform surfaces and seven navigation contracts. Generate scoped migrations/snapshot; no developer/production migration without authorization. Rollback preserves facts/in-flight completion.

## Risks & Impact Review

High: false availability can dispatch unavailable resources; fail-closed complete validation mitigates it. Residual source-edit/commit race remains explicitly observed rather than globally locked.

All write paths also risk duplicate outcomes, cross-scope references and stale clients (High; owning records/API/UI). Shared guards, scoped references, versions and atomic receipts mitigate these. Optional-source failure blocks new eligibility decisions while historical execution stays usable.

## Final Compliance Report — 2026-09-19

Guides: root/core/customers/shared/UI/backend/QA and shared contract references. Canonical primitives, encryption, scoped locked writes, additive contracts and frontend budgets specified. Data/API/UI/coverage maps to the owning App Spec stories. Runtime compliance unverified. Fresh scope review and readiness findings pending; resolve design blockers before coding.

## Implementation Status

In progress. Profile entities, scoped uniqueness/capacity/location constraints, encryption maps, master extension declarations and metadata-generated initial migration/snapshot are authored. Availability grammar and interval evaluation have 82 passing tests; authorized source adapter adds 40 tests using real ACL policy/planner merge and a mocked query engine. Parent integration registered required modules in the test fixture (the app test setup starts with none); the complete 227-test logistics suite passes. Profile/source DI/API and UI integration remain outstanding. Local generation completed; normal db:generate failed PostgreSQL authentication, so scoped SQL/snapshot were produced with the existing ORM metadata generator in connect:false mode and verified for zero snapshot drift. No migration was applied.

## Changelog

### 2026-09-19
- Expanded skeleton from approved decisions into capability-specific design and shared contract.

- F3 resolved: transient trip-free eligibility is distinct from a persisted trip-bound SourceObservation; A15 no-trip/zero-write test is required.
