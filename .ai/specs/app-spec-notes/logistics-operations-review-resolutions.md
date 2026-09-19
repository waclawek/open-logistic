# Logistics operations — review resolutions

This records author responses; it is not an independent approval.

## Context review 05b21f87 (934332c1a)

| Finding | Author decision | Changed rule |
|---|---|---|
| C1 / R1 custody recovery | Accepted; whole-job own-fleet handover is necessary for a usable breakdown path | RecoveryHandover, interrupted source outcome, separate physical releases, atomic receiving-trip start and unchanged job in_transit state |
| C2 / R2 master races | Accepted observed-snapshot consistency; no unsupported global serialization claim | SourceObservation, explicit residual master-edit/start race, authoritative revalidation and disruption after departure |
| C3 released-job deadlock | Accepted | Completion uses active obligations plus no-custody check; release closes membership and skips unperformed stops; historical ready jobs cannot block finish |
| C4 correction semantics | Accepted | Typed replacement/void, unique effective successor, serialized stream revisions, downstream consequence validation, reject contradictions with later history |
| C5 promises/retries | Accepted | PromiseRevision preserves original accepted windows; PlanRevision and linked retry stops preserve each attempt |
| W1 mileage identity | Accepted | Single immutable ledger timezone, distinct distance reconciliation/classification, explicit comparison predicate, evidenced boundaries, meter reset periods remain incomplete |
| W2 precision | Accepted | Nonzero reservation duration, palletized flag, paired location observations, missing-reading state, stop references, provenance for external non-trip cargo |
| W3 feature contract | Accepted | Command-to-feature matrix, protected fields, recorder/source separation and existing master read grants verified against acl.ts |

Additional review-driven clarification: recovery targets remain draft candidates until the atomic handover; same-driver transfer caps the source reservation before reacquiring it. A CommandReceipt records committed action results for safe retry, without treating post-commit event delivery as part of the business transaction.

Substantial domain changes require a fresh context re-review before the gate is marked passed.

## Context re-review fae43cec and workflow review a284bb51

- R2-C1 accepted: interruption now shares the no-active-unperformed-obligations/no-custody terminal predicate; unpicked jobs require explicit release/cancellation before or atomically with interruption. Added A-onboard/B-unpicked acceptance trace.
- Historical-stop warning accepted: new promises validate pending effective attempts only; handover-in/out explicitly change custody and create mileage boundaries.
- F1 accepted: a valid delivered/returned fact ends custody even without an odometer; only mileage stays incomplete.
- F2 accepted: named WF1a/WF1b and WF4a/WF4b independent trigger/end contracts inside the five release groups; job acceptance does not depend on fleet availability, correction does not invent recovery.
- F3 accepted: removed unmeasurable numerical intake/follow-up target; ordinary validation completeness is an operational input, not a claim of saved staff effort. Primary fixed-cohort empty-distance outcome remains measurable.
- F4 accepted: overdue card limited to effective pickup/delivery obligations, single current attempt, superseded history excluded; separate plan lateness for return/handover/end.
- F5 accepted: explicit populated-dashboard Create job and ready-job Plan trip actions, retained queue filters and execution-only first-reading repair on trip detail. Correction remains manager-only.

These are author resolutions of specific counterexamples; independent final review still verifies them before all gates are marked passed.

## Architect checkpoint 1 (09dd0bd3 / 04100da36)

- A1 accepted: named authorized general master/rule APIs, complete pagination and absence handling; custom-subject rules take precedence over linked rule-set rules (never union); editor-only unsaved state is not a server contract. Explicit supported UTC recurrence grammar, full-day one-off restriction, malformed-blocker fail-closed policy and DST examples precede the existing merger.
- A2 accepted: 25 work packages now expand into 33 provisional atomic commits, with C08/C09/C11/C14 split in two and C16/C18 in three; source adapter precedes dependent profile/confirmation integration. Workflow totals deduplicate shared C09/C17.
- Parent independently reran four assertions against the actual planner merger: unavailability splitting, full-UTC-day expansion, malformed blocker omission and ignored BYDAY. All passed and substantiate the need for boundary validation, not an operational application test pass.
- No unavoidable core/platform dependency found; preserve one app module and existing command/UI/event seams. Outer-transaction side effects are explicitly post-commit; no new queue framework for board refresh.

## Architect checkpoint 2 and story/criteria gate (0bf5b8fd, 589c01fd)

- B1 accepted: reject nonempty EXDATE on COUNT=1, and selected sets combining any one-off override with recurring windows crossing UTC midnight. Explicit C09b/LOG-OP-01 fixtures retain both counterexamples plus supported daytime subtraction. No core scheduler changes.
- S-C1 accepted: authoritative GETs derive source exceptions without persistence. An execution-authorized, versioned command records typed eligibility_changed disruptions, SourceObservation and receipt atomically. Unique trip/fingerprint handles concurrent different-request duplicates; acknowledgement does not alter source eligibility or automatically release custody. Updated invariant, US06/09/15, impact rows, API A08, subscribers and master-race verification consistently.
- S-W1 accepted: relative reduction requires positive baseline share as well as positive period totals; baseline E=0 permits a period ratio but yields N/A relative result and no earned badge.
- DA01–DA12 copied verbatim from the independent reviewer and challenged by PM in section 7; accepted with bounded interpretations because they protect the manual operating loop, identity or metric integrity. They remain unexecuted release requirements.
- Story reviewer independently closed R2-C1 and workflow F1–F5. Architect2 independently closed estimate A2 and confirmed existing capability/module reuse, leaving only B1. Final independent review will verify the latest specific fixes and rollout; this author note is not approval.
- Local validation: parent independently reproduced both latest planner counterexamples against actual availabilityMerge.ts and checked 33-commit arithmetic. These are source probes, not application-suite passes. Yarn suite remains unavailable without node_modules state.

## Final review (ab649bdb / 6175f481a)

- Context/identity, workflow/UX and story/criteria passed independently as App Spec gates. S-C1 and S-W1 closed; previous R2-C1 and F1–F5 closures retained. Rollout content itself passed, with final readiness dependent on the remaining architecture precision fix.
- F-B1 accepted: supported DTSTART now has exact YYYYMMDDTHHmm00Z form, zero seconds and no fractions. Reject seconds before the integral-minute crossing calculation, without truncation/rounding. C09b/LOG-OP-01 must cover the 16:00:30+8h unsupported input and 16:00:00+8h exact-midnight supported boundary against the same next-day unavailable override.
- This is a bounded input-contract clarification, not a core change or new feature. Targeted independent closure remains required; no implementation/runtime pass is claimed.

## Independent final closure (d64d0eb1 / e5f729eff)

- F-B1 independently closed against 4ce3a9e99: exact zero-second grammar makes integral-minute crossing precise; negative seconds and positive exact-midnight conformance requirements retained.
- Context, workflow and story approvals retained; architect checkpoints 1/2 and final rollout now pass at App Spec level. Main checklists record these reviewed dispositions, not a reinterpretation of the historical changes verdicts.
- Ready for user confirmation only. No feature specification, implementation, runtime or deployment evidence is implied by closure.
