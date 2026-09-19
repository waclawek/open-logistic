# Audited transport report correction

Status: DESIGN CANDIDATE — 2026-09-19.

## TLDR

Correct or void a mistaken operational fact or mileage leg without inventing new physical movement. Owns C16, A09 and US11; use the [approved App Spec](2026-09-19-app-spec-logistics-operations.md) and [shared implementation contract](app-spec-notes/logistics-implementation-contract.md).

## Confirmed design decisions

The user approved the complete App Spec on 2026-09-19. Placement is the existing app-level logistics module; no platform rewrite. Capabilities are split into seven feature specifications, as required by the approved handoff; all remain behind one complete operational release gate. No new critical business or placement question is open.

## Overview / Problem Statement

An existing effective report may be mistaken even when no trip is active and no disruption is open. Correction is a separate manager capability consuming the trip/ledger fact contracts; it remains mandatory for the same complete release.

## Proposed Solution / Architecture

Append a typed replacement or void with reason/evidence and original actor/history retained. Lock all affected trip/job/profile-ledger streams in shared order, require current versions, recompute the full consequence, reject contradictions with later facts/bookings, and atomically publish one effective successor plus revised projections and receipt. No force repair or raw before-snapshot restore.

## Data Models

Own correction provenance and unique successor rules on OperationalFact and MileageLeg. Shared entity definitions remain in data/entities.ts, owned physical fact fields by trip operations and ledger fields by reconciliation. Replacement retains its actual domain kind and typed references; void contributes no new physical action. No separate correction-kind catch-all.

## API Contracts

A09 POST facts/[id]/correct and mileage/legs/[id]/correct; manager feature combination from App Spec. Strict payload has requestId, expected record/stream versions, effect, replacement fields, correctionReason and evidenceReference. Response is original committed outcome/receipt shape; malformed or conflicting history returns unchanged with actionable conflict identity. Current scope/permissions also gate replay.

## File Manifest / UI / Frontend Architecture

commands/corrections.ts; services/corrections.ts; A09 action routes; components/trips/CorrectionDialog.tsx (typed form state), reused on trip history and mileage detail. Dialog follows shared client/guard/keyboard/i18n contract; <=300lines. No correction editor in ordinary execution forms.

## Commands / Undo / Events / Cache

Registered commands and shared transaction/receipt protocol cover every write. Guarded snapshot undo only for safe drafts; physical actions compensate/correct. Singular past-tense events emit after outer commit; indexes/list aliases invalidate on writes/undo. Sources/board/statistics are no-store reads.

## Implementation Plan

Typed successor input/model constraints → locked consequence validation and atomic correction command → manager dialog/audit history → concurrency, downstream-conflict and ledger invalidation integration. Shared physical facts must be established first.

## Integration Coverage

LOG-OP-11 plus affected10/12/13/14 and DA07: two competing successors, cross-scope targets, wrong references, void pickup supporting later handover/delivery, unchanged rejection, valid timestamp/reading repair, audit retention, reconciliation/comparison invalidation, revoked replay and encrypted evidence.

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
