# Logistics operations — architect checkpoint 1

Date: 2026-09-19. Verdict: **changes** before marking checkpoint 1 passed.

Reviewed sections 3–4.5 and the commit ledger at `62a4523f8`, the dispatched fork of `cez/32c60056`. Read the introducing diff `62a4523f8^..62a4523f8` and the subsequent branch diff through `9baef8e8f`; later workflow fixes do not resolve the adapter/estimate findings below. Line references below use the dispatched snapshot. No author conversation, implementation edits, tracker mutations or child reviews were used.

## Answer

The major reuse choices are correct. No existing transport booking/custody/mileage capability was found that replaces the proposed domain work. No unavoidable **new** core/platform dependency was identified. Keep all new business logic in the existing app `logistics` module. Existing database transactions, scoped source reads, command guards, events and UI components provide the necessary seams.

There is no compelling generic-framework overengineering in the proposal. Reservations, active occupancy, immutable custody facts and complete mileage reconciliation answer distinct accepted requirements. Do not replace these with sales orders, planner windows, staff time-entry overlap policy or asynchronous workflow instances. The concern is understated integration work and an overly precise atomic-commit count, not an excessive number of modules.

## Required corrections

### A1 — Pin the source adapter contract, especially schedule selection

Location: App Spec lines 339 and 350–352; ledger C09, line 15. Priority: high.

“Complete subject + rule-set projections” does not define which rules actually apply. `packages/core/src/modules/planner/components/AvailabilityRulesEditor.tsx:486` selects the linked rule set only when subject rules are empty and custom overrides are disabled; otherwise it uses subject rules. Blindly unioning both could restore hours excluded by a custom schedule. State the source-selection policy and require a parity fixture with both custom and linked rules present. Treat empty, absent and unreadable sources separately. Do not copy editor code into a new scheduling engine.

The merger is narrower than a recurrence/eligibility service: `packages/core/src/modules/planner/services/plannerAvailabilityService.ts` accepts caller-supplied rules and dates, with no fetching, authorization, timezone argument or booking operation. `lib/availabilityMerge.ts:32` parses a limited DAILY/WEEKLY grammar, uses UTC, ignores unsupported clauses and silently omits unparseable rules. Its one-off availability becomes an entire UTC day. A malformed unavailability rule therefore need not block an otherwise available interval. C09 must specify the accepted grammar/time semantics and reject unsupported inputs **before** calling the merger, with explicit UTC/day-override/DST examples. An IANA timezone field alone does not make recurrence timezone-aware. Keep window coverage checking app-local; do not silently promise local-time recurrence or patch planner.

Name the concrete authorized reads now: resources `api/resources.ts`, staff `api/team-members.ts`, planner `api/availability.ts` and `api/availability-rule-sets.ts`, all under `packages/core/src/modules/`. Masters expose `is_active`, `availability_rule_set_id`, `updated_at`; rules expose subject identity, timezone, recurrence, exclusions, kind and version. The respective GET grants include `resources.view`, `staff.view`, `planner.view`. Read every required page (rule lists cap at 100), validate exact tenant/organization and record the selected membership/version set. If choosing the query engine instead, preserve equivalent feature checks and absence detection; an entity ID is not authorization. Do not claim one cross-module transactional snapshot from paginated/versioned reads: the accepted observed-snapshot limitation remains.

Do **not** use `staff/api/team-members/assignable/route.ts` as the driver selector: it filters out members without a linked user (line 180) and uses customer-specific grants. Drivers without login accounts require the general team-members projection. Staff absence should disable dependent eligibility writes while retaining logistics snapshots and execution completion. This matches `staff/AGENTS.md`, implemented spec `2026-05-08-staff-decouple-from-core.md`, and `planner/api/access.ts`'s optional resolver behavior; no staff entity import or new resolver contract is necessary.

### A2 — Distinguish work packages from atomic commits

Location: App Spec lines 307–321; ledger lines 14–24. Priority: medium.

The arithmetic is correct: 27 workflow contributions, less shared C09 and C17, equals 25 unique units. The sizes are uneven. C08 combines booking serialization, occupancy, receipts and actions; C09 combines source authorization/pagination, optional-module handling and rule semantics; C11 implements the complete fact/custody lifecycle; C14 spans two trips, jobs and independent releases; C16 spans typed corrections, downstream validation and UI; C18 spans reconciliation and API/UI. Calling each one atomic with all targeted tests obscures risk.

Keep 25 as a **work-package estimate**, or provisionally split C08/C09/C14/C16 into 2–3 commits each, C11/C18 into two each: **31–35 testable commits**, before further feature design. This is an engineering estimate, not a cost/date commitment or a requirement to manufacture commits. Recompute workflow scores after grouping, retain shared accounting and tests with behavior, and explicitly sequence C09 before source-dependent profile/confirmation integration. No scope cut is proposed. C24 remains adversarial cross-flow coverage, not a substitute for tests in each increment.

## Verified boundaries and implementation cautions

| Area | Local evidence | Assessment |
|---|---|---|
| Module ownership | `packages/core/AGENTS.md` Cross-Module Coupling; existing `apps/mercato/src/modules/logistics/` pages/ACL/setup | One app domain is appropriate. Scalar references, owned profiles and snapshots avoid duplicate master registries and cross-module ORM relationships. |
| Booking versus availability | `planner/di.ts`, `planner/services/plannerAvailabilityService.ts`, `planner/lib/availabilityMerge.ts` | Availability is declared windows, not reservations. New scoped resource/job serialization and active occupancy are necessary; ordinary record optimistic locking alone cannot arbitrate two different trips. |
| Atomic commands | `packages/shared/src/lib/commands/flush.ts:119`; `runCrudCommandWrite.ts:44` | Reuse is real. Explicit `transaction: true` is required for atomic multi-phase `withAtomicFlush`; the CRUD wrapper defaults to a transaction. Neither helper provides transport locks or durable request receipts. |
| Side effects and receipts | `runCrudCommandWrite.ts:56–82` | Side effects occur after its write block. For multi-entity actions use one outer transaction, emit/index only after its commit, and account for all changed entities. A nested helper can return while an ambient transaction remains open. Keep receipt/state atomic and distinguish committed outcome from post-commit refresh failure. No private outbox framework is justified. |
| Events | `packages/events/src/modules/events/api/stream/route.ts`; `packages/events/AGENTS.md` | Scoped standard DOM broadcast exists. Refresh/focus/visible polling is a sufficient correctness fallback. C23 needs no new persistent queue merely to refresh the board. |
| UI | `packages/ui/src/backend/schedule/types.ts:1`, `ScheduleView.tsx`; `.ai/ui-backend-components.md` | Day/agenda modes, DataTable, CrudForm, KPI/detail/filter/conflict families already fit. New work is domain composition and action handling. Shared primitives do not automatically wire every dialog shortcut or mutation guard; verify each consumer. |

The source observation audit is justified; avoid extending it into a cross-module locking system. Persist essential evidence once per decision, use authoritative queries for correctness, and keep the board a derived view. Append-only operational facts need not imply a generalized event-sourcing framework. Generic command undo must not bypass the constrained correction rules.

No tracker search was warranted: the accepted bounded planner semantics can be consumed through existing surfaces. If a later requirement demands fully timezone-aware recurrence or linearizable eligibility across master writes, that is a separate platform dependency decision, requiring the specified read-only tracker investigation before any scope change. It is not silently included here.

## Verification and limits

- Runner: local. No local compose override files/explicit override; development compose probe returned no running app, fullapp probe could not interpolate missing `JWT_SECRET`. No environment or credentials changed.
- `git diff --check 62a4523f8^..62a4523f8`: passed. Review-note diff check: passed before commit.
- Attempted `yarn workspace @open-mercato/core test --runInBand --runTestsByPath src/modules/planner/__tests__/plannerAvailabilityService.test.ts`: **blocked**, Yarn could not find the node_modules state file. No application-suite pass is claimed.
- Four assertions executed successfully with Node v24.19.0 importing the actual `planner/lib/availabilityMerge.ts`: recurring unavailability splits a window; one-off availability expands to a UTC day; malformed unavailability is skipped; unsupported BYDAY is ignored. These confirm adapter hazards, not operational implementation correctness.
- Documentation-only review: no migrations, runtime changes, production dependencies, generated files, core changes or push. Only this review note is committed. No parent completion report existed in the supplied root unit; claims were assessed from the reviewed documents and source.

Checkpoint can pass after A1 is made explicit and A2 relabels/revises the estimate. This verdict does not approve implementation or replace the later feature-spec, integration and UI gates.
