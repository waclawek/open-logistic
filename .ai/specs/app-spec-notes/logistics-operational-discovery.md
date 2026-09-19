# Logistics operational release — discovery and authoring plan

Date: 2026-09-19. Status: business answers received; operational domain draft under review. This is a research note, not an approved App Spec or feature specification.

## Assignment

Extend [the existing Logistics App Spec](../2026-09-19-app-spec-logistics-dashboard.md) to cover the first operational release: transport jobs, trips, lifecycle/status rules, resource assignment and an operational dispatcher dashboard. The user requests subsequent end-to-end implementation. The explicitly selected `om-app-spec-writing` skill requires the completed App Spec to be confirmed before feature specifications or implementation.

## Verified starting point

| Area | Evidence | Consequence for the App Spec |
|---|---|---|
| Logistics foundation | `apps/mercato/src/modules/logistics/components/LogisticsPage.tsx`, `lib/sections.ts`, `README.md` | Seven guarded pages show planned capabilities. There are no logistics business entities, APIs or assignments yet. Preserve existing URLs and read access. |
| Foundation validation | `docs/logistics/verification.md` | Prior recorded evidence reports 48 unit and 24 browser tests passing. These were not rerun during this discovery; the report also records Windows-wide test limitations. |
| Customers | Existing `customers` module and the foundation's ownership glossary | Reuse customer identity; distinguish a transport job from a Sales order. |
| Vehicles/resources | `packages/core/src/modules/resources/data/entities.ts`, `api/resources.ts` | Resources already provide identity, active state, a generic integer capacity with unit and an availability rule-set reference. Define logistics-specific requirements without creating a competing resource registry. |
| Drivers/personnel | `packages/core/src/modules/staff/data/entities.ts`, `AGENTS.md` | Staff members already have identity, active state and optional user association. A driver record need not be a login account. Staff entity internals are not a cross-module contract. |
| Availability | `packages/core/src/modules/planner/di.ts`, `services/plannerAvailabilityService.ts`, `data/entities.ts` | A registered service merges supplied availability rules over a range. This service is not a transactional trip reservation mechanism. Specify authoritative booking-conflict protection separately. |
| Activation | `apps/mercato/src/modules.ts` | Logistics, customers, resources, staff and planner are enabled in this app. Enabled here does not establish a general platform dependency contract. |
| UI | `.ai/ui-backend-components.md` | Reuse DataTable, CrudForm, ScheduleView, KpiCard, standard details and conflict UI. No new generic schedule or dashboard framework is needed. |
| Stock availability spec | `.ai/specs/2026-08-14-availability-contract.md` | This describes inventory/commerce availability, not driver or vehicle scheduling. It is not a transport booking solution. |

## Business questions submitted to the user

1. Who pays and what drives growth: proposed internal own-fleet transport company, paid by customers for deliveries, increasing jobs per fleet and reducing empty kilometres; alternatives include subcontractor operations or selling the software.
2. Primary measurable release goal: proposed 30% reduction in median accepted-job-to-confirmed-assignment time, comparing two baseline weeks with four pilot weeks. This target is a proposal, not measured evidence or a commitment by the user.
3. Release exclusions: proposed manual entry, manual planning and dispatcher-entered execution updates; GPS, optimization, AI, billing and driver/customer portals deferred. Confirm whether GPS or direct driver updates are necessary for the first usable release.

User answers: **Own-fleet transport company; Fewer empty kilometres; Yes—manual dispatch first.** These decisions replace the corresponding assumptions. The proposed dispatch-speed target was not selected. The operational App Spec retains the foundation's 10% relative empty-kilometre reduction as a clearly labelled proposal for final confirmation, not a user-confirmed target.

## Authoring sequence after discovery

1. Extend the existing source-of-truth App Spec, retaining the foundation's history and clearly separating implemented navigation from proposed operations. Define exact fields, terminology, ownership, identities and lifecycle/assignment invariants. Run the independent context challenger.
2. Define 3–7 complete workflows with measurable outcomes, exception paths and per-step platform mapping. Specify the dashboard and primary task paths. Estimate atomic commits and run the workflow challenger plus architect checkpoint 1.
3. Write user stories with alternate/failure outcomes, the cross-story impact matrix, event responsibilities and integration coverage. Map each story through existing features, configuration and extension points before new domain code. Run the story challenger and architect checkpoint 2.
4. Define usable release increments, rollout, backward compatibility and concrete acceptance criteria. An independent DDD reviewer authors domain criteria; the PM evaluates their business necessity. Run the final challenger and validate document links/diff.
5. Present the completed App Spec, review evidence, estimates and unresolved decisions for user confirmation. Only then decompose into feature specs and implement.

## Rules the operational specification must resolve

- Job/trip cardinality; pickup-before-delivery; partial deliveries and load consolidation boundaries.
- Exact legal transitions, cancellation rules, failure/return handling, corrections and recorded-versus-actual times.
- Vehicle/driver eligibility; capacity dimensions and units; availability coverage; timezones and boundary intervals.
- Competing assignments, stale edits, retries, transaction rollback and audit/event consistency.
- Availability, capacity or active-state changes after an assignment; revalidation and recovery without silently losing the original booking.
- In-progress trip overruns, reassignment and cargo custody during disruptions.
- Organization isolation, read/write features and absent optional-module behavior.
- Dashboard metric definitions, filter scope, missing/stale/error states and data refresh behavior.

No application code, feature specifications, database migrations or tracker mutations have been made during discovery. The Phase 0 context challenger has been dispatched against the committed domain draft; other gates are pending authored sections.

## Additional platform evidence

- `plannerAvailabilityService.getMergedAvailabilityWindows` accepts supplied rules and a date range, not subject IDs or a booking request. It does not query source data or serialize assignments. A logistics boundary must read authorized source projections, distinguish no rules from a service failure, and validate the returned coverage.
- `planner/lib/availabilityMerge.ts` parses a constrained DAILY/WEEKLY representation, uses UTC expansion and treats once-only rules as full days. Do not promise arbitrary recurrence or timezone semantics that this implementation does not provide. Test the supported planner editor output around DST and expose unsupported schedules explicitly.
- `planner/api/availability.ts` supports subjectType and comma-separated subjectIds with pageSize ≤100; complete availability reads must not silently use just the first page. Existing rule-set and subject rules must both be considered.
- `shared/lib/commands/runCrudCommandWrite.ts` commits entity phases through withAtomicFlush and then performs custom-field and side-effect work. Post-commit side-effect failure does not imply the business transaction rolled back. The command result/retry and event-delivery policy must distinguish these cases.
- `shared/lib/commands/command-interceptor.ts` exposes before/after execute and undo hooks, but does not itself guarantee a shared transaction with another module's writes. Do not claim a before hook alone eliminates master-data races.
- `ui/backend/schedule/types.ts` provides day/week/month/agenda modes with dated resource/member items. A first dispatch board can combine this with DataTable and standard detail/forms; no custom drag-and-drop planning engine is required.
