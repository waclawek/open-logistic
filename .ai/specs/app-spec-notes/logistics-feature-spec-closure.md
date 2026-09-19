# Logistics feature scope closure

Reviewed 2026-09-19. **Verdict: changes — one remaining manifest inconsistency (F1).** This is a targeted specification-boundary review, not runtime approval or renewed business discovery.

Snapshot: `a2d9e0db4f27c04b993d390e941e5a84867c1d3b`, the review worktree's fork point on `cez/32c60056`. Read both new specs first, then the five retained specs, shared contract and [prior review](logistics-feature-spec-review.md). Inspected the complete eight-file specification change in `b1bb2b5e8..a2d9e0db4`, and checked the approved App Spec and commit ledger for retained scope. The parent advanced to `3d039b3444792640be973648e3f7180c35ff484f` during review; its specification diff from the snapshot is empty. Its additional availability implementation is outside this assignment.

Applied the installed `C:/Dev/open-logistic/.ai/skills/om-spec-writing/references/spec-checklist.md`, specifically section 1's independent-capability, traceability and phasing tests. This is the fresh reviewer; no children were created, as instructed. Root and specs-folder rules govern the note. No blanket implementation compliance audit is claimed.

## Capability verdicts

| Capability | Verdict for this review | Boundary evidence |
|---|---|---|
| Fleet readiness | **Approve; F3 closed** | `logistics-fleet-readiness.md:25` defines trip-free transient EligibilityResult, A15 zero writes, and persistence only by the owning trip command with a real tripId. The changelog requires the no-trip/zero-write test. Profiles and eligibility remain usable without jobs/trips. |
| Job intake | **Approve; F4 closed** | `logistics-job-intake.md:25,31,33,39` assigns unassigned PromiseRevision to commands/jobs.ts, explicitly lists POST jobs/[id]/promise and JobDetail, and requires jobs.manage plus view. Assigned changes delegate to the trip transaction with dispatch authority and trip/job/plan versions; both cases have specified tests. No second promise command owner is introduced. |
| Trip operations | **Changes; F1 nearly closed** | US03–US10/C06–C15 now cover the coupled planning/execution/recovery lifecycle. Facts/revisions/consequence validation remain its producer contract. A09 still appears in its implementation file manifest at line 37; resolve the inconsistency below. |
| Report correction | **Approve capability cohesion; F1 pair requires manifest cleanup** | `logistics-report-correction.md:7,15,19,23,27,31` owns C16/US11/A09, typed replacement/void provenance, successor commands and manager dialog for both facts and mileage legs. Correction works on existing history without a new trip or disruption. Shared consequence validation is a dependency, not a reason to duplicate physical actions. |
| Mileage reconciliation | **Approve; F2 closed** | `logistics-mileage-reconciliation.md:9,25,29,33,41,45,72` owns C17/C18, C19 ledger settings, A10/A11/settings and day/ledger UI. It exposes effective totals, coverage, revision and correction seams; excludes correction/cohort commands. Reconciled days are useful before comparison exists. |
| Cohort comparison | **Approve; F2 closed** | `logistics-cohort-comparison.md:7,19,23,27,31,43` owns remaining C19/C20, US14, A12 cohort/freeze, A13 and their UI. It consumes ledger timezone/totals/revisions, retains frozen disabled vehicles, suppresses undefined improvement and recomputes after correction. It neither owns ledger settings nor writes custody/ledger during calculation. |
| Dispatch board | **Approve** | `logistics-dispatch-board.md:7,17,31,37` remains one read projection and authorized links to owning actions, with no alternative booking/custody command or GET write. Operational producers remain prerequisites. |

Paths in the table are the dated `2026-09-19-` feature documents in the parent specs directory; line numbers refer to the snapshot above.

## Remaining finding

### F1 residual — Medium: trip manifest still includes correction routes

**Location:** `.ai/specs/2026-09-19-logistics-trip-operations.md:37`; compare its `:31,80` and `.ai/specs/2026-09-19-logistics-report-correction.md:27,31`.

The trip manifest still says `typed A04-A09/A16 routes`. The correction manifest separately owns `A09 action routes`, while the trip API and final boundary explicitly give A09 to correction. The intended owner is clear, but two implementation inventories still claim the same routes. A worker following the trip manifest would include work deliberately extracted into C16.

**Required closure:** change the trip manifest range to A04–A08/A16; retain A09 solely as an explicit consumer/integration reference. No new design decision or scope reduction is needed. The correction command and dialog were already removed correctly from the trip manifest. References to correction invariants and integration tests may remain in trip operations; those protect its producer contract and do not create duplicate ownership.

This is the only concrete boundary blocker found. It is not an assertion that duplicate handlers exist in runtime code.

## Release-scope conservation and checklist result

- C01–C03/C09 remain fleet readiness; C04–C05 intake; C06–C08/C10–C15 trip lifecycle with the unassigned promise action explicitly allocated to intake; C16 correction; C17/C18 and C19 settings reconciliation; remaining C19/C20 comparison; C21–C25 board and complete-release verification. Shared work-package references describe integration, not separate implementations of the same action.
- All seven documents retain the single complete operational release gate. The shared contract retains C01–C25, the provisional 33 increments, LOG-OP-01..16 and DA01..12. Nothing here permits partial pilot deployment.
- Correction retains atomic downstream consequence validation, unchanged rejection, audit/single-successor history and reconciliation/comparison invalidation. It does not introduce physical movement. Cohort comparison retains fixed population/timezone, complete-only E/L/U/T, zero/unknown handling, exact relative reduction and late-correction withdrawal. No split drops these release requirements.
- Checklist section 1: seven cohesive operator capabilities; clear producer/consumer seams and testable plans; no additional split or business question identified. API/UI ownership is explicit except the F1 manifest range. Security, arithmetic implementation, availability code, concurrency behavior, performance and runtime compliance are outside this targeted closure and remain unverified.

## Exact checks

Runner: **local documentation checks**, as allowed by the approved App Spec's spec-only validation rule at line 651. No application tests/builds, database actions or external writes were performed.

1. `git rev-parse HEAD` and `git merge-base HEAD cez/32c60056` initially returned `a2d9e0db4f27c04b993d390e941e5a84867c1d3b`; the initial fork-to-reviewed-tip diff was empty.
2. `git diff b1bb2b5e8..a2d9e0db4 -- .ai/specs` inspected both new documents and every retained/shared-document change. `git diff --name-only b1bb2b5e8..a2d9e0db4` returned exactly seven feature documents and the shared contract; no runtime files.
3. `git diff --check b1bb2b5e8..a2d9e0db4`: exit 0.
4. Local PowerShell required-heading check across seven feature specs: **63/63 passed** (TLDR, models, API, plan, integration coverage, compatibility, risks, compliance report, changelog).
5. Local PowerShell Markdown-link check across seven feature specs, shared contract and approved App Spec: **32 relative file targets passed**. External URLs and anchors were not tested.
6. `rg -n -g '2026-09-19-logistics-*.md' 'typed A04|A09 action routes|owns C16|EligibilityResult|POST jobs/|C19|A12' .ai/specs` confirmed the ownership declarations and the residual A09 manifest overlap.
7. After the parent advanced, `git diff --exit-code a2d9e0db4..cez/32c60056 -- .ai/specs` returned 0 at parent tip `3d039b3444792640be973648e3f7180c35ff484f`. The unfiltered diff is nonempty due to independent availability code; it is not evidence against these specs.

Parent `units/32c60056/notes.md` and `report.md` were unavailable in the supplied tree. No parent runtime-test claim, including the intake changelog's 31 tests, was adopted as verified evidence. Only this closure note is committed; the report supplies its commit and clean-worktree result.
