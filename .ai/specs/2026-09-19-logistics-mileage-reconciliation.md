# Fleet mileage reconciliation

Status: DESIGN CANDIDATE — 2026-09-19.

## TLDR

Reconcile every vehicle-day, including non-trip movement.

Source of truth: [user-confirmed operational App Spec](2026-09-19-app-spec-logistics-operations.md). Trace: US12-US13; C17-C18 and C19 ledger settings; A10/A11/A12 settings; LOG-OP-12-14.

## Confirmed design decisions

The user approved the complete App Spec on 2026-09-19. Placement is the existing app-level logistics module; no platform rewrite. Capabilities are split into seven feature specifications, as required by the approved handoff; all remain behind one complete operational release gate. No new critical business or placement question is open.

## Overview / Problem Statement

The navigation foundation has no operational persistence. Non-trip ledger/day reconciliation functions without trip execution. Full release integrates trip facts within their command transaction.

## Proposed Solution / Architecture

Apply the [shared implementation contract](app-spec-notes/logistics-implementation-contract.md) and every App Spec refinement. Exact tenths of km; incoming leg uses custody before destination. Missing evidence never invents distance. No time/odometer overlap; E+L+U=T for complete days. Unknown cargo can reconcile distance but not improvement. No midnight prorating; DST/reset/gaps remain incomplete. Corrections invalidate day reviews and comparison. Relative reduction also requires positive baseline empty share.

## Data Models

MileageLeg, VehicleDay and MileageLedgerSettings use exact approved definitions. VehicleProfile.ledgerRevision serializes ledger/review changes. Reporting timezone is immutable after first ledger entry. Every day needs evidence; missing is not zero. Comparison consumes effective totals/revision; correction consumes the guarded replacement seam.

## API Contracts

A10 mileage/legs GET/POST; A11 mileage/days GET/POST/PUT and /[id]/reconcile POST; A12 measurement/settings GET/PUT. Approved mileage/measurement grants apply to each action, with requestId and ledger/day versions. Typed rows include evidence, decimal readings/loadState and completeness; no client-created derived trip cargo. A09 correction and A12 cohort/A13 comparison are owned by linked specs.

## File Manifest / UI / Frontend Architecture

lib/mileage.ts; commands/mileage.ts; services/mileageLedger.ts; A10/A11/settings routes; components/mileage/MileageList.tsx (table), LegForm.tsx and DayReview.tsx (forms), LedgerSettingsForm.tsx (timezone setup), route-local server wrappers. Shared <=300-line client budget, forms/guards, five locales and hydration evidence apply.

## Commands / Undo / Events / Cache

Registered commands and shared transaction/receipt protocol cover every write. Guarded snapshot undo only for safe drafts; physical actions compensate/correct. Singular past-tense events emit after outer commit; indexes/list aliases invalidate on writes/undo. Sources/board/statistics are no-store reads.

## Implementation Plan

Exact rules/non-trip ledger with profile revision → synchronous trip boundaries and replacement consequence seam → day review/settings UI → LOG-OP-12/14 with correction/comparison integration contracts. No cohort command or report-correction route owned here.

## Integration Coverage

LOG-OP-12/14 and DA09: workshop/positioning/no-job/no-motion, unknown load, gaps/overlap/reset/midnight/DST, mandatory versions/scope/permissions, immutable reporting timezone, stale reconciliation invalidation. Cross-capability tests prove corrections invalidate effective day revisions and comparisons observe them; exact comparison formulas belong to cohort-comparison tests.

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

## Capability ownership refinement

This spec owns C17/C18, A10/A11 and A12 ledger settings. [Cohort comparison](2026-09-19-logistics-cohort-comparison.md) owns MeasurementCohort/freeze, A13 statistics and comparison UI (remaining C19/C20). [Report correction](2026-09-19-logistics-report-correction.md) owns A09 leg replacements/voids. Ledger provides effective rows, revision and invalidation/consequence seams; no duplicate correction/cohort commands are implemented here. Earlier references describe integration requirements, not extra feature ownership.
