# Independent DDD review: logistics operations context and identity

Date: 2026-09-19. Verdict: **changes**. Sections 1–2 are not yet ready to pass the context gate. This is a review and recommendations, not approval of implementation or a change to the App Spec.

Reviewed `cez/32c60056` at `90940bade8c8c022cc552776e5c40034d8d1e74e`. Reviewer fork equals that tip, so the fork-to-parent diff is empty; also inspected the actual authoring delta `d0d006782..90940bade` (operational App Spec, foundation cross-reference, discovery note). Confirmed constraints: own fleet, fewer empty kilometres, manual dispatch first. No prior challenger result was used. Locations below refer to the operational App Spec at this revision.

## CRITICAL — resolve before passing the context gate

### C1. R1: breakdown recovery has no truthful terminal path

**Location:** `.ai/specs/2026-09-19-app-spec-logistics-operations.md:34`, `:75`, `:88`, `:90`, `:97`.

After pickup, a truck breaks down and another own-fleet truck collects its cargo. The source trip cannot complete until its jobs are terminal, cannot cancel, and cannot release custody to another trip. Editing its vehicle would attribute earlier movement to the replacement; recording delivery/return would invent a physical fact. Both resources remain occupied as a pair even if the driver has actually been relieved. A disruption description alone cannot resolve these invariants.

**Minimal recommended R1 decision:** permit a narrowly defined, manager-authorized recovery handover between own-fleet trips, transferring each affected job's entire cargo without splitting it. Keep the job `in_transit`; atomically close its source membership, open destination membership, and record source/destination trip, job, place, occurred/recorded time, recorder, reason and evidence of handover. Distinguish handover from a second customer pickup. Validate receiving capacity, resource reservation/occupancy and both trip versions; lock the job as well as resources. Failed or duplicate commands must leave one effective custodian. The receiving trip's load starts at handover; neither vehicle's prior mileage changes.

Add an `interrupted` trip outcome for physically ended source trips whose cargo is entirely delivered, returned or explicitly handed over. Release vehicle/driver occupancy only on recorded physical release, separately when their release times differ; a broken vehicle remains unavailable through the fleet/planner authority. A delayed source trip that will resume instead stays `in_progress` with custody and occupancy retained. Do not treat opening or resolving a disruption as handover or physical release. Add an explicit past-tense handover fact/event.

This is a recommendation for the author to adopt, not an assumption that transfer already belongs to the approved scope. If transfer remains excluded, explicitly support only hold-and-resume on the same vehicle and label real transfers as unsupported/unresolved; that truthful restriction cannot be described as complete breakdown recovery.

**Falsification case for later coverage:** transfer two onboard jobs to a recovery trip, fail validation for one, retry the same request, and concurrently attempt another transfer. No partial handover, duplicate custody, fabricated delivery or duplicate mileage may result.

### C2. R2: master-data freshness is stronger than the proposed consistency boundary

**Location:** operational App Spec `:63`, `:95`, `:100`; `packages/core/src/modules/planner/services/plannerAvailabilityService.ts`; `packages/shared/src/lib/commands/command-interceptor.ts`.

Dispatch reads an active driver and covering availability; a master editor disables the driver or inserts an unavailable interval; dispatch then commits. Logistics resource locks and expected logistics versions do not serialize the source edit. A second availability read only moves the race. The inspected planner service merges supplied rules; it does not query/lock sources. The interceptor interface provides before/after hooks, not a demonstrated transaction spanning all source writes. The discovery note correctly acknowledges these limits.

**Minimal recommended R2 decision:** guarantee exclusivity and active occupancy strongly inside logistics, and describe source eligibility/availability as **validated against an observed source snapshot**, not continuously guaranteed or linearizable with master edits. Record observation time, source identities/versions and the evaluated interval/rules; include relevant rule-set changes, additions and removals, not just versions of rows previously returned. Re-read on confirm/replan/start; fail closed when unreadable or unsupported. Source-change signals invalidate eligibility and mark affected plans for review; use authoritative revalidation as well because notifications may be delayed. Retain reservations and custody. If a change is discovered after departure, open a disruption instead of undoing physical departure.

State the residual edit-versus-start race explicitly. This minimal boundary preserves master ownership without claiming a guarantee that the inspected contracts do not provide. If zero race is mandatory, leave R2 blocked for an architect to prove a common serialization protocol across **every** relevant edit/delete/undo path and dispatch; a generic before hook or eventual subscriber is insufficient. Do not claim that stronger option is implemented or available already.

**Falsification case:** insert a new unavailable rule between dispatch validation and commit. The specified result must follow the chosen consistency contract; it must not silently claim a fresh, universally valid booking.

### C3. Released jobs can permanently block finishing a trip

**Location:** operational App Spec `:74`, `:88`, `:90`.

Execution may release an uncollected job to `ready` while preserving its TripJob history. Completion nevertheless requires “every included job” to be delivered/returned/cancelled. A ready job still in historical membership can therefore trap an otherwise finished trip and its resources.

**Resolution:** define active membership precisely and make the completion predicate inspect only current obligations, plus an unconditional no-cargo-custody check. Release must atomically close membership, mark its unperformed stops skipped with a reason and revalidate the remainder. Historical membership stays visible but does not require a terminal job status. Explicitly permit physical finish after all unpicked jobs are released; the nonempty requirement applies to initial confirmation, not this recovery case.

### C4. Append-only corrections cannot reconstruct corrected truth from the listed fields

**Location:** operational App Spec `:76`, `:78`, `:101`, `:110`.

An OperationalFact with `kind=correction`, a target and optional note does not say whether the replacement is pickup, delivery, a changed timestamp or a void. Two managers can append competing successors to the same immutable fact unless the effective stream is serialized. Mileage replacement permits a successor but does not specify branch prevention; a late pickup correction can change subsequent load classifications and already completed trips.

**Resolution:** define a typed replacement payload (or replacement fact retaining its actual domain kind), a mandatory correction reason and explicit void semantics. Require kind-specific job/stop references and enforce that stop, job and trip belong together, not merely to the same organization. Allow one effective successor per fact/leg, with acyclic same-scope links and expected stream/aggregate revision checked atomically. Rebuild effective custody, downstream mileage and reconciliations in one defined correction operation. If that would contradict a later trip/resource history, reject with the conflicting records or require an explicit compound repair; never reopen an occupied vehicle silently. Distinguish a corrected report from a new physical event.

### C5. Delivery retry conflicts with immutable promises and lacks an attempt model

**Location:** operational App Spec `:71`, `:73`, `:82`, `:90`, `:98`.

A delivery fails today and the customer agrees to tomorrow. Replanning must satisfy the job's windows, while original accepted windows must remain unchanged. No effective revised promise is listed. Retrying the same stop also risks overwriting failed arrival/departure/odometer data with the successful attempt.

**Resolution:** keep accepted windows immutable; record an authorized revised promise with reason, agreement and time, and validate the active plan against that promise. Retain each failed stop attempt; append a linked retry stop with its own timestamps/readings. Only a successful delivery/return ends custody. Plan revisions must retain the previous confirmed stop snapshots. A minimal attempt link and promise revision are sufficient; no generic workflow engine is needed.

## WARNING — tighten before stories and implementation

### W1. Mileage day identity and completeness need one definition

**Location:** operational App Spec `:79`, `:80`, `:108`, `:110`.

VehicleDay is unique by vehicle/date but each cohort can choose a timezone. The same date cannot represent both Warsaw midnight and UTC midnight. Choose one immutable reporting timezone per organization/pilot ledger and require cohorts to use it for this release. A future multi-zone reporting design must use separate day identities/boundaries.

Define distance reconciliation separately from load classification: exact leg coverage with unknown load can be distance-complete, but cannot qualify for improvement. A residual unrecorded gap is reported as U and keeps reconciliation incomplete; never materialize it as verified empty. State the final comparison predicate explicitly: all expected days reconciled, U=0, classified distance equals T, and T>0 in both periods. Midnight splits need measured or evidenced corrected boundaries; reason text alone must not turn an estimate into verified mileage. Specify how odometer replacement/reset is represented, or explicitly keep the affected period incomplete pending an evidenced offset/repair.

### W2. Field constraints leave avoidable ambiguity

**Location:** operational App Spec `:65`, `:69`, `:71`, `:73`, `:78`, `:96`, `:99`.

Clarify that “equal endpoints” means adjacent reservations, not a zero-duration reservation; require start < end. Make derived timestamps/statuses server-owned, and pair lastKnownPlace with lastKnownAt/source so a fresh timestamp cannot accompany an unrelated location. Define required departure/end odometer boundaries or an explicit missing-reading state. Define exactly one effective final end stop and valid per-kind job references. Separate “not palletized” from “palletized but count unknown”; NULL currently risks serving both meanings. Explain the system-derived cargoJobIds for loaded non-trip movement: either link supported custody or record external-cargo provenance; an explanation alone must not manufacture custody of an existing job.

### W3. Identity model needs an action-to-feature contract

**Location:** operational App Spec `:124`, `:125`, `:130`, `:132`.

The personas and feature names are sensible, but custom roles expose missing decisions: can execution permission correct old facts, can mileage permission reclassify loaded movement, and can fleet permission close a breakdown or approve a handover? Specify server-side feature requirements per command and protected field. Distinguish recording readings from manager reconciliation/correction. Preserve recorder identity separately from the driver who supplied the report. Keep master selectors scoped and minimal; explicitly define which master read features are needed rather than granting broad personnel access to make dispatch work. Missing optional source capability must disable dependent operations with a clear reason, not create a second driver registry.

## OK — retain these decisions

- Sections 1.1–1.3 distinguish paying customer, transport job, sales document, trip, reservation and declared availability. Own-fleet/manual scope matches the confirmed goal.
- Sections 1.2 and 1.4 include workshop, positioning, return and no-job days in a frozen-cohort denominator. Unknown mileage and no movement cannot masquerade as improvement; the target is correctly labelled proposed.
- Pickup changes subsequent load; returned customer cargo stays loaded until return. Multiple onboard jobs count distance once. Disruptions do not themselves release custody or bookings.
- Resource serialization, separate active occupancy, child versions, scoped idempotency and post-commit factual events are appropriate logistics rules. Events are correctly excluded from enforcing transactional custody/booking invariants.
- Section 2 reuses accounts and master identities, keeps drivers/customers out of internal login roles, uses feature guards and preserves read-only access.

## Evidence and gate disposition

Inspected paths: the operational App Spec in full (review scope sections 1–2); foundation App Spec introduction/context and changed cross-reference; `.ai/specs/app-spec-notes/logistics-operational-discovery.md`; `C:/Dev/open-logistic/.ai/skills/om-app-spec-writing/references/challenger-prompt.md`; `.ai/specs/AGENTS.md`; `.ai/docs/agent-instructions.md`; `.ai/skills/om-code-review/SKILL.md`; the planner service and command-interceptor files cited above; dispatch `brief.md` and this task's rolling handoff. The supplied task order and root instructions were also read. No parent report exists under a parent unit in this tree; author claims were checked from the discovery note and commits instead. Platform inspection was limited to these contracts, not proof that every master mutation path supports a common lock.

Runner: local, documentation-only checks. `git diff --check d0d006782..cez/32c60056` passed. No application tests/builds were run or claimed: the reviewed change is a proposed domain/identity document, and no operational implementation exists to test. Later workflow tests listed here are review criteria, not executed evidence. `git diff --cached --check` also passed for this note; the committed-range check is reported in the task evidence.

The context gate requires C1–C5 to be resolved in the App Spec, with the R2 guarantee stated truthfully; warnings should be carried into the next authoring pass. Review work is complete; the verdict remains **changes**, not rejection of the overall direction. Only this review note is changed. No code, workflow recursion, child tasks, tracker writes or pushes.
