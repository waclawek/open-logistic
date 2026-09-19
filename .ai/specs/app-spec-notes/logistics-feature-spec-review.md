# Independent logistics feature-spec review

Reviewed 2026-09-19. **Verdict: changes** (specification boundaries and contract clarification; no runtime defect asserted).

Inspected `cez/32c60056` at **36586a8a8e22b29f9c1ea755aaab687f1b95bd2c**. Review worktree fork point is that same commit, so the fork-to-reviewed-tip diff is empty. The substantive feature addition is `43a25b65d401b5cbe2a4fdfabb30c6755714a053`; reviewed its six added files via `59275e852..36586a8a8`. No implementation changes occur in that range.

Read the five feature specs first, independently of prior reviewer conclusions, then their shared contract, approved operational App Spec and commit ledger. Applied the installed `C:/Dev/open-logistic/.ai/skills/om-spec-writing/references/spec-checklist.md` (especially §1) and `compliance-review.md`. No children, installs, runtime edits or feature-spec edits. This note records the requested independent review, not a blanket implementation-compliance certification.

## Capability dispositions

| Feature | Cohesion | Implementation disposition | Reason |
|---|---|---|---|
| [Fleet readiness](../2026-09-19-logistics-fleet-readiness.md) | **Cohesive** | **Changes — F3** | A manager can create profiles and assess eligibility without jobs or trips. Source reads and eligibility explanation complete that outcome. |
| [Job intake](../2026-09-19-logistics-job-intake.md) | **Cohesive** | **Changes — F4** | Customer work can reach the ready queue without fleet availability. The unassigned promise action needs an explicit implementation owner. |
| [Trip operations](../2026-09-19-logistics-trip-operations.md) | **Split — F1** | **Changes** | Planning, execution and physical recovery share custody invariants; correction of mistaken reports is a separately usable capability against their fact contract. |
| [Mileage reconciliation](../2026-09-19-logistics-mileage-reconciliation.md) | **Split — F2** | **Changes** | A reconciled daily ledger has an independent outcome before a frozen baseline/pilot comparison exists. |
| [Dispatch board](../2026-09-19-logistics-dispatch-board.md) | **Cohesive** | **Ready against prerequisite contracts** | One read projection with links to owning actions. It needs operational producers but adds no competing booking/custody lifecycle. This does not authorize pilot deployment before the complete release gate. |

## Findings

No critical finding. No newly missing business decision: own-fleet scope, module placement, recovery, exact mileage rules, permissions and the complete-release gate are supplied by the approved App Spec.

### F1 — Medium: separate report correction from physical trip operations

**Location:** `2026-09-19-logistics-trip-operations.md:7,17,21,25,35,45`; App Spec `:253-257,265`; commit ledger C16.

The feature combines planning/execution/recovery with typed correction/void and its manager UI. The approved App Spec itself calls correction an independent subflow: it needs neither an open disruption nor new movement. Execution/recovery can produce facts without invoking correction; correction can operate on existing effective facts without running a new journey. Sharing fact revisions, downstream validation and an outer transaction does not make these the same operator capability.

**Recommendation:** raise a maintainer scope question to separate audited fact/leg correction (C16, A09) from physical trip operations. Keep correction mandatory for the same release, and retain synchronous validation of custody/ledger consequences. Do not split pickup, handover, source disposition and resource release into independently committing operations. No automatic rewrite or scope reduction is proposed.

### F2 — Medium: separate fixed-cohort comparison from daily reconciliation

**Location:** `2026-09-19-logistics-mileage-reconciliation.md:7,21,25,31,45`; App Spec `:271-284,483-485`; commit ledger C17-C20.

This feature contains two useful outcomes: a complete vehicle-day ledger and a frozen-cohort baseline/pilot comparison. Non-trip recording and day reconciliation remain useful without a measurement cohort; comparison can consume an established reconciled ledger. Their seam is effective totals, completeness and ledger revision, not a single command that must atomically freeze a cohort and reconcile a day.

**Recommendation:** raise a maintainer scope question for separate ledger/reconciliation and cohort/comparison specs. Keep organization ledger timezone with ledger setup; cohort timezone must reference it. Assign A10/A11 versus cohort/freeze and A13 explicitly; preserve A09 correction ownership and late-correction invalidation across the seam. Both capabilities remain required in the approved release.

### F3 — Medium: distinguish trip-free eligibility results from persisted observations

**Location:** `2026-09-19-logistics-fleet-readiness.md:17,25,31`; App Spec `:102`; shared implementation contract `:33`.

Fleet readiness promises evaluation without trips, yet says SourceObservation retains the exact App Spec fields, whose `tripId` is required. A15 takes a range and optional profile IDs, without a trip. The shared prohibition on GET persistence is correct, but the texts do not distinguish the transient evaluation shape from the persisted trip-bound record. Reusing the exact record shape would require a nonexistent trip; persisting an observation in A15 would violate the read contract.

**Recommendation:** explicitly define a transient eligibility result/source snapshot without persisted identity or trip requirement; the owning trip command attaches its real trip ID and persists the observation within its transaction. Test A15 with no trips and zero writes. This clarifies a technical representation, not a new business policy.

### F4 — Medium: explicitly allocate unassigned promise revisions

**Location:** `2026-09-19-logistics-job-intake.md:25,31`; `2026-09-19-logistics-trip-operations.md:31`; App Spec `:177-178,298` and A03; commit ledger C10.

Intake assigns later PromiseRevision to trip planning and enumerates only accept/cancel for A03. Trip operations enumerates A04-A09/A16, leaving the A03 promise route unallocated in the feature inventories. The approved contract already requires an unassigned agreed promise revision under jobs.manage, with assigned changes delegated to atomic replanning. Thus the requirement is present, but following the feature manifests alone can omit the unassigned route or incorrectly require trip authority.

**Recommendation:** name the A03 promise route, job-detail action and unassigned command owner explicitly; specify delegation of assigned revisions to trip planning. Cover a ready job with no trip and only jobs.manage, plus the assigned permission/version case. No new decision about customer agreement is needed.

## Shared-contract and checklist assessment

| Area | Design assessment |
|---|---|
| Scope and phasing | Changes: F1/F2. A single pilot release does not waive checklist §1's independently deployable-capability test. No new packages or separately exposed partial release are required. |
| Models/API/UI consistency | Changes: F3/F4. App Spec refinements remain normative, including palletized cargo, recovery drafts, effective obligations and missing-reading repair. Abbreviated feature sections need not duplicate those requirements. |
| Security and compatibility | Specified: trusted tenant/organization scope, current exact/wildcard grants, scoped source projections, encryption inventory and additive app-module placement. Runtime compliance remains unverified. |
| Commands and concurrency | Specified: outer transaction, canonical receipt/profile/trip/job locks, own-record versions even with the compatibility switch off, atomic receipt replay and postcommit effects. R1-R6 resolve substantial implementation detail; do not reopen these as absent decisions. |
| Undo and correction | Safe draft/profile undo is distinguished from physical compensation; correction rejects contradictory downstream history. F1 concerns capability ownership, not removal of those protections. |
| Cache and performance | No-store source/board/statistics reads, scoped CRUD invalidation, pagination, batched references and frontend budgets are specified. One browser request is not proof of bounded backend queries; query-count/large-fleet evidence remains an implementation check, not evidence supplied by this review. |
| UI and testing | Shared forms/tables/HTTP/guard helpers, server roots/client leaves, five locales, hydration evidence, LOG-OP-01..16 and DA01..12 are prescribed. Builds, concurrency, encryption and UI behavior have not been executed for nonexistent operational code. |

Rule cross-check used the supplied root instructions, `.ai/specs/AGENTS.md`, relevant sections of core/customers/shared/UI/backend/QA guides, compatibility contract and installed frontend-architecture reference. It did not independently certify every MUST across every implementation guide. No need to reopen the approved business scope, numerical target confirmation or deployment-specific cohort/date configuration to resolve these findings.

## Exact checks and evidence

Runner: **local documentation checks**; no application gate or Docker runtime was started. The approved App Spec explicitly selects relative-link, required-section and diff checks for spec-only work.

- `git rev-parse HEAD` and `git merge-base HEAD cez/32c60056`: both returned the inspected full commit above.
- `git diff --exit-code 36586a8a8..cez/32c60056`: exit 0; reviewed branch content matched the inspected commit.
- `git diff --name-only 59275e852..36586a8a8`: exactly five feature specs plus their shared implementation contract; no runtime files.
- `git diff --check 59275e852..36586a8a8`: exit 0.
- Local PowerShell required-section check over the five feature specs: **45/45 passed** (TLDR, models, API, plan, coverage, compatibility, risks, compliance report, changelog).
- Local PowerShell Markdown-link check over those five specs, shared contract and approved App Spec: **26 relative file targets passed**; external URLs and anchor validity were not tested.
- Parent unit `notes.md`/`report.md` were not present at the supplied tree's `units/32c60056/` path; no unavailable parent test claim was treated as evidence.

No runtime test/build claim is made. Review-note commit and clean-worktree evidence are reported to the parent after committing this sole artifact.
