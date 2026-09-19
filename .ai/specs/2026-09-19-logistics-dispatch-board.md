# Dispatch board

Status: DESIGN CANDIDATE — 2026-09-19.

## TLDR

Provide a read-only operational projection and authorized entry links to existing logistics actions.

Source of truth: [user-confirmed operational App Spec](2026-09-19-app-spec-logistics-operations.md). Trace: US15-US16; C21-C25; A14; LOG-OP-15/16.

## Confirmed design decisions

The user approved the complete App Spec on 2026-09-19. Placement is the existing app-level logistics module; no platform rewrite. Capabilities are split into five feature specifications, as required by the approved handoff; all remain behind one complete operational release gate. No new critical business or placement question is open.

## Overview / Problem Statement

The navigation foundation has no operational persistence. Read-only projection deploys against established logistics contracts; it owns no alternate custody or booking commands.

## Proposed Solution / Architecture

Apply the [shared implementation contract](app-spec-notes/logistics-implementation-contract.md) and every App Spec refinement. Include yesterday active trips. Overdue counts only effective pickup/delivery promises; return/handover/end plan lateness separate. Visible refresh30s plus focus/action; stale60s. Abort/ignore old-org or out-of-order reads. Error retains labelled stale data rather than zeros. Primary task entry<=3clicks with keyboard/mobile.

## Data Models

No mutable operational entity. Project ready jobs, current trips, effective overdue obligations, resource/source observation ages and mileage coverage. Seven destinations remain; map/automatic proposals honestly planned.

Common scope/version, encryption, exact decimals, indexing and immutable history follow the shared contract; no opaque payloads or cross-module ORM.

## API Contracts

A14 dashboard GET, with date/range/place/resource filters, bounded section paging and complete scoped counts. logistics.view plus source grants for source-specific fields. Return observedAt/scope, totals/cursors and typed exceptions. Action links invoke owning capabilities; no GET writes.

Shared contract defines responses/errors, guard protocol, versions, receipts, custom fields and authorization.

## File Manifest / UI / Frontend Architecture

api/dashboard/route.ts; services/dashboard.ts; components/dashboard/DispatchBoard.tsx (filters/refresh lifecycle), ReadyJobs.tsx, ActiveTrips.tsx, DispatchExceptions.tsx (tables/action links); existing server page wrapper; no global providers/heavy map imports.

Each named client leaf owns the stated browser state, remains <=300 lines and uses shared forms/tables/dialog primitives. No client page roots/global providers/heavy root imports. Stable entity and extension handles, five locales, keyboard submission/cancel, conflict UI and hydration evidence are required.

## Commands / Undo / Events / Cache

Registered commands and shared transaction/receipt protocol cover every write. Guarded snapshot undo only for safe drafts; physical actions compensate/correct. Singular past-tense events emit after outer commit; indexes/list aliases invalidate on writes/undo. Sources/board/statistics are no-store reads.

## Implementation Plan

Complete aggregate/effective-obligation queries → small board client leaves and action links → navigation/access/hydration/locale coverage and complete-release runbook.

## Integration Coverage

LOG-OP-15/16: >100jobs and count agreement, yesterday active, superseded retries, old-org/out-of-order replies, read-only warning zero writes, lost event refresh, keyboard/mobile and existing Customers/navigation.

Create/clean own fixtures; cover each method/path and changed interactive route. Full ordered repository gate remains required.

## Migration & Backward Compatibility

Additive schema/routes/features only; preserve thirteen platform surfaces and seven navigation contracts. Generate scoped migrations/snapshot; no developer/production migration without authorization. Rollback preserves facts/in-flight completion.

## Risks & Impact Review

High: stale/wrong-scope display misleads or leaks data; server scoping and request generation prevent it, owning commands revalidate actions. Temporary staleness remains visibly labelled.

All write paths also risk duplicate outcomes, cross-scope references and stale clients (High; owning records/API/UI). Shared guards, scoped references, versions and atomic receipts mitigate these. Optional-source failure blocks new eligibility decisions while historical execution stays usable.

## Final Compliance Report — 2026-09-19

Guides: root/core/customers/shared/UI/backend/QA and shared contract references. Canonical primitives, encryption, scoped locked writes, additive contracts and frontend budgets specified. Data/API/UI/coverage maps to the owning App Spec stories. Runtime compliance unverified. Fresh scope review and readiness findings pending; resolve design blockers before coding.

## Implementation Status

Not started.

## Changelog

### 2026-09-19
- Expanded skeleton from approved decisions into capability-specific design and shared contract.
