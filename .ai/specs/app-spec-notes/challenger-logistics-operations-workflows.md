# Logistics operations: independent workflow and UX review

Verdict: **changes**. Reviewed the committed `cez/32c60056` snapshot `62a4523f83f704ed7b7809fd879902ab086619e9`, specifically sections 3 and 3.5, lines 184–307 of `../2026-09-19-app-spec-logistics-operations.md`. Line references below refer to that snapshot, not subsequent parent edits.

Read sections 1.3/1.4 as domain context and section 2 for navigation permissions; applied `C:/Dev/open-logistic/.ai/skills/om-app-spec-writing/references/challenger-prompt.md`. Confirmed constraints: own fleet, fewer empty kilometres, manual dispatch first. This is a bounded specification review, not approval of implementation or a second generic context review.

## CRITICAL — must fix

### F1. Missing odometer wording can prevent a truthful delivery from ending custody

**Location:** WF3 edge 4, line 228; completion definition, line 226.

The instruction to record the physical event with a missing reading but “do not free cargo” conflicts with the workflow's completion path and the domain's separation of custody from mileage (lines 113–115, 137). Counterexample: the driver confirms full delivery but cannot supply the odometer. Following the edge literally leaves the job onboard, so an otherwise finished trip cannot close and its resources remain occupied. Inventing a reading would become the only apparent escape.

**Minimal fix:** explicitly say that a valid pickup/delivery/return fact applies its normal custody transition even without a reading; only the affected mileage remains incomplete. A missing reading alone never implies a custody transition. Include delivery-without-reading followed by physical finish as the workflow counterexample to test.

## WARNING — should fix before story acceptance

### F2. WF1 and WF4 each bundle independently completable work

**Location:** WF1 start/end, lines 190–194; WF4 journey/start/end, lines 241–243.

WF1 combines resource onboarding with accepting an individual customer request. An established fleet can accept a job without onboarding anyone; a manager can onboard a vehicle without an accepted job. Its joint end condition can accidentally gate intake on availability that belongs to WF2. WF4 explicitly calls correction a separate activity but gives recovery and correction one completion contract and disruption-only metrics. Correcting a mistyped time on a completed trip needs neither a breakdown nor a new physical outcome.

**Minimal fix:** retain the five release groups if useful, but name independent subflows: WF1a resource readiness / WF1b job acceptance; WF4a physical recovery / WF4b fact correction. Give each its own trigger and terminal state. Job acceptance ends at `ready`, irrespective of fleet availability; resource eligibility is evaluated for an explicit planning interval. A rejected correction ends with unchanged facts and a linked investigation, not a fabricated recovery movement. Recovery supplies a new executable plan, and WF3 records its subsequent physical execution. This requires no extra module or release phase.

### F3. WF1's claimed KPI source cannot distinguish a data correction from a normal amendment

**Location:** WF1 ROI, line 192; section-level source claim, line 186.

“Without a follow-up data request” and “without a subsequent required-data correction” are different observations. A dispatcher may telephone twice before acceptance and then never amend the job: the proposed proxy scores that job as clean. Conversely, a customer legitimately changes a delivery window after acceptance, which is not missing intake data. “Measured from revisions” does not specify which record identifies required-data corrections; the contextual model names plan/promise revisions but no classified intake-correction observation.

**Minimal fix:** choose and label one measurable proxy. For example, accepted jobs with no recorded intake-data correction within a defined observation window / accepted jobs whose window has elapsed. Identify the audit/revision source and required correction classification, exclude customer-agreed changes, and report unknown coverage if those observations were not collected. Alternatively remove the numerical intake target until its evidence source is defined. Do not present ordinary field validation as observed operational ROI.

### F4. The overdue-stop card has no precise rule for failed attempts and non-promise stops

**Location:** dashboard definitions, line 295; retry/return workflow, lines 241–245.

“Pending/failed effective obligations” leaves the projection from attempts to outstanding obligations undefined. Counterexample: a delivery failed Monday, its replacement retry is agreed for Tuesday, and the old failed attempt remains immutable. Monday's failed row must not remain an additional overdue obligation after Tuesday succeeds. A return or handover also has a planned time but no original customer pickup/delivery promise of its own; using the job's delivery window can produce a misleading overdue card.

**Minimal fix:** define one outstanding obligation per job/action with an explicit current attempt, exclude superseded/settled attempts, and define the due-time source for each included stop kind. Either limit this card to pickup/delivery promises and expose other overdue plan actions separately, or name the broader operational metric clearly. Require card and drill-through fixtures covering failed attempt → revised retry → success, plus a return/handover without a customer promise.

### F5. The named primary navigation paths need explicit entry actions and permission outcomes

**Location:** page inventory, lines 282–291; primary paths, line 299; empty states, line 303.

The click paths rely on `New job` from a populated dashboard and `Plan trip` from a selected ready job, but the dashboard blocks and job-detail actions do not name those entry points. The only dashboard Create job instruction is its empty state. A dispatcher with a nonempty queue should not have to discover a different path. Mileage is described as a manager page yet dispatchers are sent there by missing-reading prompts; an execution-only dispatcher needs a useful repair or escalation destination rather than a denied page.

**Minimal fix:** list the dashboard Create job action and ready-job Plan trip action, with the selected job prefilled and server readiness rechecked. Define whether execution users can append a missing reading on trip detail or hand it to a manager; make the link resolve to that authorized surface and show who can repair it. Preserve read-only logistics access without displaying unusable mutation controls. Specify filtered return navigation so selecting a job/trip does not lose the working queue.

## Boundary and evidence assessment

| Workflow | Independent value and completion | Metric/source assessment |
|---|---|---|
| WF1 | Job intake and fleet readiness need the independent subflow contracts in F2. Source-unavailable and stale-form paths preserve input. | Numerical proxy needs the source/observation rule in F3. |
| WF2 | Confirmed plan/reservation is a valid boundary before execution. Failed confirmation retains the draft; no reservation on abandonment. | Fixed-cohort E/T is the actual outcome. Multi-job trip share is only a leading indicator: two nearby jobs can still require more empty positioning than one well-matched return load. The text correctly avoids claiming causality. |
| WF3 | Physical completion can precede mileage reconciliation; F1 must preserve this distinction. Duplicate requests, overruns and released unpicked jobs have realistic paths. | Terminal-custody completeness is an invariant, not financial ROI. Fact `occurredAt`/`recordedAt` provide a latency source; keep that operational framing. |
| WF4 | Recovery and correction need separate endpoints under F2; custody handover and resource release are explicit, and a rejected correction preserves current state. | Disruption open/resolved times support duration, but this does not measure correction throughput. Unresolved count prevents a resolved-only median from hiding unfinished recovery. |
| WF5 | Daily reconciliation can complete without waiting for the entire pilot; comparison is a later outcome in the same measurement group. Explicit incomplete results allow dispatch to continue. | Vehicle-day envelopes, effective legs and frozen cohort provide E/T and coverage. Four/eight-week windows and 10% reduction remain proposals, not demonstrated savings. Zero distance, missing midnight evidence and late corrections are handled honestly. |

## OK — retain

- Shared fleet context and manual place/date matching support the confirmed goal without implying GPS, automated route ranking or legal feasibility. Optional estimated distances remain separate from actual mileage.
- Server-side scoped aggregates, identical-filter drill-through, explicit interval availability and observation ages are appropriate dashboard rules, subject to F4.
- Refresh-on-focus/action plus timed refresh, stale snapshots, Retry, and immediate organization-state reset cover missing-data and stale-response UX without treating failures as zero.
- The seven existing destinations match `apps/mercato/src/modules/logistics/lib/sections.ts`; Map stays honestly planned. The module has five locale files as claimed.
- The component inventory supports `KpiCard`, `DataTable`, `CrudForm`, `ScheduleView`, standard detail/error/conflict states. Use DataTable's built-in FilterBar rather than mounting a second one; adapt domain statuses into ScheduleItem metadata. No custom map, calendar engine or speculative component family is necessary.

## Validation and limits

Runner: local (read-only Git/PowerShell checks; no Yarn gate required for this review note).

- Inspected the workflow/UI changes introduced by `git diff 62a4523f8^..62a4523f8` and their glossary/domain dependencies. The review branch was forked at the named parent tip, so the fork-point-to-parent diff was empty; the introducing commit supplies the actual reviewed change.
- `git diff 62a4523f8^..62a4523f8 --check`: passed, no output.
- Cross-checked route definitions, locale inventory and `.ai/ui-backend-components.md`; reviewed the proposed commit ledger only to check the stated evidence sources.
- No executable workflow implementation exists in this snapshot, so no runtime workflow test or application build is claimed. Counterexamples above are specification acceptance cases for the parent to resolve while drafting stories.
- Only this review note is committed; no code, source specification, tracker, branch automation or shared-branch changes.
