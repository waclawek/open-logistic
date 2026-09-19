# Independent context re-review: logistics operations, round 2

Date: 2026-09-19. Verdict: **changes**. One remaining CRITICAL context flaw; do not mark the context gate passed yet. This is a document review, not implementation verification.

Reviewed sections 1–2 of `.ai/specs/2026-09-19-app-spec-logistics-operations.md` at `cez/32c60056`, commit `8f47b1a17dddfd9e7cc8bc3c8bdeddc1a8b9fdd4`, against the supplied DDD challenger prompt. The reviewer fork equals that tip: `git diff 8f47b1a17..cez/32c60056` is empty. Independently read the substantive revision `e7ce85d56..cez/32c60056`, the prior C1–C5/W1–W3 review and author resolution note. The revision changes only the operational App Spec and resolution note. Line references below are to the reviewed operational App Spec. Later pending sections are outside this verdict.

## CRITICAL — R2-C1: interruption can strand an uncollected assigned job

**Locations:** §1.4 state machines, lines 115 and 117; recovery handover, lines 119 and 121.

The new `interrupted` outcome has a weaker finish predicate than `completed`. Line 119 permits interruption once all cargo is accounted for and physical end is recorded. It does not require remaining unpicked active memberships to be released or cancelled. Line 115 explicitly applies its active-member terminal-state predicate to completion. The general statement that source obligations must permit resource release (line 121) is not a defined interruption predicate or a cleanup of those memberships.

**Minimal counterexample:** source trip S has picked up job A and has not yet collected assigned job B. S breaks down. A is wholly handed to target T using a different driver; A's source membership closes and T becomes its sole custodian. S now has no cargo. Record physical end and interrupt S under line 119. B still has an active membership on S and status `assigned`. B cannot be assigned elsewhere because active membership is unique; S cannot execute B because it is terminal. The stated ordinary release path is during execution (line 117), not after interruption. Either B is stranded or an implementer invents an undocumented post-terminal cleanup. Keeping a resource blocked under line 121 does not restore an executable trip.

**Minimal fix:** make both physical terminal outcomes require no remaining active unperformed obligations and no cargo custody. Before interrupting, every uncollected assigned job must be explicitly released to `ready` or cancelled under the existing authorization, closing membership and marking its remaining stops skipped with a reason. Reject interruption until this is done, or include the selected dispositions atomically in the interruption command with their existing feature/version checks. Historical memberships and onboard jobs already transferred/delivered/returned do not block interruption. Preserve independent resource-release times and the broken-vehicle dispatch restriction. No new entity, reopening workflow or force repair is needed.

**Acceptance trace:** repeat A+B above. Interrupt-without-B-disposition must fail without changing source status or B. Release B, then interrupt: B is ready, has no active S membership, and can be planned elsewhere; A remains in transit solely on T. A failed combined disposition/interruption must leave all participating records unchanged. Also check the source with only unpicked jobs and no cargo: absence of cargo alone must not authorize terminal abandonment of its jobs.

This is the remaining edge of C1 and the new interrupted-state counterpart of C3, not a request to expand beyond own-fleet recovery.

## Prior finding disposition

| Finding | Result against revised context |
|---|---|
| C1 / R1 recovery | **Partially resolved.** Lines 94–102 and 119–121 now define reciprocal whole-job handover, draft target, atomic start, single custody, separate physical releases and broken-vehicle restriction. R2-C1 above still blocks full resolution. |
| C2 / R2 source races | **Resolved at the specified consistency level.** Lines 100, 126 and 131 capture observed versions/rule membership, fail closed on unavailable sources, revalidate authoritatively, retain reservations/custody, disclose concurrent master edits, and open disruptions after departure. This does not assert a simultaneous cross-module snapshot or continuous eligibility. |
| C3 released-job completion | **Resolved for completed trips.** Lines 115–117 exclude released history and close membership/skip stops atomically. Initial nonempty confirmation no longer prevents physical finish after release. Apply the same obligation discipline to interruption as R2-C1 requests. |
| C4 corrections | **Resolved as a domain contract.** Lines 107–109 define typed assert/void payloads, reference agreement, unique successor/no cycles, serialized revisions, atomic downstream recomputation and rejection of contradictions. Actual lock/transaction coverage remains for implementation review. |
| C5 retry/promise model | **Core representation resolved.** Lines 94, 98–99, 117 and 129 preserve failed attempts, append linked retries, version effective promises and confirmed plans, and retain original accepted promises. Clarify historical-stop validation below. |
| W1 mileage integrity | **Resolved.** Lines 103 and 139–141 define one ledger timezone, distinguish distance completeness from load classification, require complete periods/U=0/T>0, and require evidenced boundaries. Reset periods remain incomplete instead of manufacturing mileage. |
| W2 field precision | **Resolved in the normative additions.** Lines 89–104 and 127–129 distinguish palletization, pair place/time/source, forbid zero-length bookings, require final-end identity and missing-reading state, and restrict non-trip loaded mileage to external cargo provenance. |
| W3 identity/action grants | **Resolved at context level.** Lines 163–179 state feature combinations, protected fields, selector permissions and missing-capability behavior. Existing master read IDs were independently checked in the four module ACL files. |

## WARNING — clarify validation of effective stops and handovers

**Locations:** lines 76, 94, 99, 119, 129–130 and 137.

A Monday failed delivery followed by a customer-agreed Tuesday retry has a sound representation now. However, the generic rule that planned stops satisfy effective promise windows does not explicitly exclude preserved historical attempts. State that new plan feasibility validates pending effective obligations against the selected promise revision; completed/failed/skipped history stays tied to its recorded plan and is not revalidated against Tuesday's revised window. The failed Monday attempt must neither block Tuesday's replan nor be rewritten to Tuesday.

Similarly, align the general load/boundary wording with the explicit handover rule: handover-in acquires custody and handover-out releases it; both are mileage boundaries (or explicit missing readings). Delivery requires effective prior custody from pickup or handover-in, not a fabricated pickup on the receiving trip. Lines 119–121 already supply the special transition, so this is consolidation of the general wording, not a second CRITICAL absence of recovery semantics.

## Adversarial transition checks

These are manual specification traces, not executed application tests.

- **Two-job handover, one invalid:** line 119 requires all-or-nothing validation of both trips/jobs/resources and the complete target load sequence. Failed capacity/version/occupancy validation leaves source custody unchanged. Competing handovers serialize on the same jobs; only one may acquire custody.
- **Same-driver recovery:** line 121 caps the driver's source reservation and ends occupancy before the target interval in the same transaction. The source vehicle can remain separately occupied; releasing it disables dispatch. A source continuing with remaining cargo must retain its assigned occupied driver. R2-C1 separately closes the terminal/uncollected-job hole.
- **Duplicate command after response/event failure:** line 105 writes the scoped receipt atomically with state. Same digest replays the committed IDs/versions subject to current authorization; changed digest conflicts. Lines 145–147 make event delivery follow committed truth. No second transfer or fresh pickup is justified by a missing response. Precommit failure leaves no success receipt.
- **Two corrections to one fact:** lines 107–109 permit one effective successor and serialize the fact/ledger revisions. A competing stale correction fails. Voiding pickup while a later delivery/handover depends on it must be rejected with the conflicting record; no silent reopening or removal of later custody is allowed. A permitted time correction recomputes dependent mileage and invalidates reconciliation atomically.
- **Failed delivery then retry:** failure leaves custody unchanged; the new attempt retains independent readings/times. The promise revision and plan snapshot retain the original acceptance and prior plan. Only successful delivery/return ends custody; historical validation needs the wording clarification above.
- **New unavailability rule after observation:** a source may change after the recorded evaluation and before commit. That residual race is expressly allowed, not hidden. Authoritative refresh detects rule-set insertions/removals even without a notification; after departure the result is a disruption, not undoing the physical start. Strong logistics reservation/custody exclusivity remains required.
- **Released final unpicked job:** release closes membership/skips stops; the now-empty executing trip can complete after its physical end and resolved disruptions. Historical `ready` status cannot block completion. The interrupted variant is the failed trace above.

## Evidence and gate disposition

Runner: **local**, documentation-only validation. `git diff --check e7ce85d56..cez/32c60056` and the fork-to-parent diff check passed with no output. The complete authoring revision was read, including the resolution note. Independent `rg` checks confirmed `customers.people.view`, `customers.companies.view`, `resources.view`, `staff.view` and `planner.view` in their module `acl.ts` files. The review note's staged diff check passed before commit; committed-range verification is included in the task report.

No application build/unit/integration tests were run or claimed: the reviewed delta is a proposed domain/identity document without an operational implementation to execute. The adversarial traces above falsify or support its stated rules; they are future implementation test cases. Read the task brief/order/handoff, supplied challenger reference, specs rules, prior review/report and author resolutions. No parent-unit report exists in this tree; the author claims were taken from the committed resolution note and checked against the diff.

Only this review note is committed. No main-spec edits, implementation, child dispatch, skill recursion, tracker writes or pushes. Review assignment is complete; verdict remains **changes** until the interruption predicate is repaired. Approval of later workflows or production readiness is not implied.
