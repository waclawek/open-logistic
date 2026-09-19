# Fixed-cohort mileage comparison

Status: DESIGN CANDIDATE — 2026-09-19.

## TLDR

Compare complete reconciled baseline/pilot periods for a frozen fleet population. Owns C19 cohort/metric portion and C20, US14, A12 cohort/freeze and A13 statistics. Source: [approved App Spec](2026-09-19-app-spec-logistics-operations.md).

## Confirmed design decisions

The user approved the complete App Spec on 2026-09-19. Placement is the existing app-level logistics module; no platform rewrite. Capabilities are split into seven feature specifications, as required by the approved handoff; all remain behind one complete operational release gate. No new critical business or placement question is open.

## Overview / Problem Statement

A reconciled daily ledger is independently useful. This capability consumes its effective totals, coverage and revisions to measure the approved empty-kilometre goal without changing the population or hiding missing evidence.

## Proposed Solution / Architecture

Freeze explicit cohort vehicles/timezone/periods before baseline. Derive decimal E/L/U/T and coverage from the established ledger. Only complete periods with T>0 and U=0 yield comparable shares; relative reduction additionally requires baseline share>0. Undefined results never earn a target badge. Late correction recomputes from ledger revisions and can withdraw improvement. Read-only calculation never mutates custody or ledger.

## Data Models

MeasurementCohort and normalized vehicle membership; exact App Spec fields and immutable freeze. Timezone must equal the ledger settings owned by reconciliation. Membership persists when profiles disable; altered cohort/periods require a new comparison. No cached persisted aggregate that can outlive ledger revision.

## API Contracts

A12 /measurement/cohorts GET/POST/PUT and /[id]/freeze POST; A13 statistics GET. logistics.measurement.manage for configuration plus view; current scope/versions/receipt for writes. Output includes frozen membership, periods, E/L/U/T, completeness/missing days, defined ratios or N/A reason and ledger revision/time. A12 settings GET/PUT belongs to reconciliation, not this spec.

## File Manifest / UI / Frontend Architecture

commands/measurement.ts; cohort/freeze/statistics routes; services/statistics.ts; components/mileage/CohortForm.tsx (form state), StatisticsView.tsx (filters/coverage drill-through), server statistics wrappers. Shared frontend budgets/guards/i18n apply; no new global provider.

## Commands / Undo / Events / Cache

Registered commands and shared transaction/receipt protocol cover every write. Guarded snapshot undo only for safe drafts; physical actions compensate/correct. Singular past-tense events emit after outer commit; indexes/list aliases invalidate on writes/undo. Sources/board/statistics are no-store reads.

## Implementation Plan

Frozen cohort data/commands and ledger-timezone validation → exact comparison query/arithmetic → setup/statistics UI → self-contained complete/incomplete/correction fixtures.

## Integration Coverage

LOG-OP-13/14, DA10/11: fixed population, disabled vehicle retained, late correction invalidation, empty/no-distance/unknown days, exact25%→22.5%=10%relative, worsening negative result, zero baseline share N/A, frozen-edit rejection, configuration/replay authorization.

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
