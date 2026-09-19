# Logistics operations — final independent rollout and targeted closure

Date: 2026-09-19. Verdict: **changes**. One narrow availability-boundary contradiction remains (F-B1 below). The manual operating release, retained context/workflow closures, explicit source-change action, metric rules and independently authored acceptance criteria otherwise hold within this review's scope. This is App Spec review only: eventual approval means ready for **user confirmation**, never implementation authorization, operational test success or deployment readiness.

Reviewed `cez/32c60056` at **`7d2efcc41cbe39bcd8043aa6ee251f19601dfd3a`**, also this review's fork point. `git diff 7d2efcc41..cez/32c60056` was empty; independently read the substantive `7d2efcc41^..7d2efcc41` resolution diff and the complete [operational App Spec](../2026-09-19-app-spec-logistics-operations.md). All specification line references below identify that revision. Read the root brief, supplied challenger prompt, applicable root/spec/core guidance, [author resolutions](logistics-operations-review-resolutions.md), [commit ledger](logistics-operations-commits.md), retained context/workflow reviews, both architecture checkpoints and [story/criteria review](challenger-logistics-operations-stories-criteria.md). Author resolutions were treated as claims. No broad source rediscovery or child dispatch was performed.

## HIGH / major — F-B1: accepted seconds can evade the midnight rejection

**Location:** App Spec lines 375–379, supported grammar and accepted-combination restriction; affects C09b / LOG-OP-01 and architect B1 closure.

Line 375 accepts a finite UTC DTSTART without requiring zero seconds. Line 379 defines midnight crossing as `start minute-of-day + duration minutes >1440` and says an interval ending exactly at midnight is allowed. An implementation using integer UTC hour/minute components for that stated predicate accepts a start with nonzero seconds whose actual end crosses midnight. The general instruction to reject crossings and its concrete arithmetic therefore disagree on an accepted input. Source parsing explicitly preserves seconds (`planner/lib/availabilityMerge.ts:41`); this is not an unsupported parser input.

**Executed counterexample:** selected rules are:

```text
availability:   DTSTART:20260921T160030Z;DURATION:PT8H;FREQ=DAILY
unavailability: DTSTART:20260922T000000Z;DURATION:PT24H;FREQ=DAILY;COUNT=1
range:         [2026-09-22T00:00:00Z, 2026-09-23T00:00:00Z)
```

The minute predicate gives `16*60 + 8*60 = 1440`, hence no crossing. The actual merger returns `[2026-09-21T16:00:30Z, 2026-09-22T00:00:30Z)`. Clipping to the requested day leaves 30 seconds available despite its all-day unavailability override. A positive booking interval `00:00:00–00:00:20` would pass coverage; the spec imposes no minimum minute granularity on booking timestamps. The override filters recurring windows by their start date (`availabilityMerge.ts:204`), retaining the preceding day's tail just as in the original B1.

**Minimal required correction:** explicitly reject nonzero DTSTART seconds in the supported app grammar, or define crossing with exact UTC seconds/milliseconds including seconds. Preserve the distinction between an actual midnight end and an end after midnight. Add this fixture to C09b / LOG-OP-01 with the expected unsupported result, alongside an exact-midnight positive boundary. No core scheduler change or broader recurrence support is necessary. Amend only the App Spec/associated acceptance requirements, then obtain targeted independent closure; this reviewer has not changed the source document.

The two original B1 fixtures are now explicitly rejected by line 379: COUNT=1 with any nonempty EXDATE; any selected one-off plus a recurring overnight window of either kind. Their original merger hazards and the supported weekly daytime subtraction were independently reproduced. B1 is **substantially addressed, not fully closed** until timestamp precision is unambiguous.

## Targeted closure and regression traces

These are specification traces except for the separately identified executed source probes.

| Finding | Current evidence and attempted counterexample | Disposition |
|---|---|---|
| S-C1 read/write responsibility | Lines 137, 155–157, 409, 417, 433, 448, 457, 460, 610 and 647 agree. After an unavailable rule is inserted and its event lost, a read-only GET derives an exception with no stored observation/disruption. Only the named command with execution grant, trip version and requestId rereads/verifies the fingerprint and atomically records observation, disruption, actor and receipt. Changed input/source fails unchanged. Unique trip/fingerprint also covers concurrent different requestIds. Acknowledgement suppresses only that fingerprint; new fingerprints remain detectable. No automatic custody/release follows. | **Closed.** No hidden GET/subscriber writer or new automation is required. Exact storage/serialization still needs implementation proof. |
| S-W1 zero baseline | Lines 32 and 538 permit baseline E=0/T=100 as a 0% period ratio but require N/A relative reduction for pilot E=0 or E=10 with positive T. No earned badge or cohort exclusion follows. The positive 25% to 22.5% example is 10% relative improvement; worsening stays negative. | **Closed.** Positive period totals and positive baseline share are separate requirements. |
| Context R2-C1 | Lines 117–127, DA06 and line 649 retain the A-onboard/B-unpicked trace: transfer A, reject interruption until B's explicit release/cancellation closes membership/skips stops; failed combined disposition is unchanged. Historical membership cannot strand A or block the source. | **Closed, no regression.** |
| Historical attempts and handover | Line 127 keeps Monday's failed attempt tied to its old promise, validates only pending Tuesday obligations, and recognizes handover-in/out as custody/mileage boundaries. Target delivery does not require a fabricated second pickup. | **Closed, no regression.** |
| Workflow F1 | Lines 117, 240, 413 and DA04 separate valid delivery without reading from incomplete mileage. Cargo ends on delivery; missing mileage alone cannot trap physical finish. | **Closed, no regression.** |
| Workflow F2 | Lines 204 and 257 independently bound resource readiness/intake and recovery/correction. A job can be accepted without a free truck; a rejected correction needs no invented physical recovery. These specific subflow contracts govern the broader release-group summaries. | **Closed, no regression.** |
| Workflow F3 | Lines 202–204 retain validation completeness as an operating input, with no unsupported follow-up savings target. | **Closed, no regression.** |
| Workflow F4 | Line 311 gives one effective pickup/delivery obligation, retires superseded attempts and separates return/handover/end plan lateness. Monday failure → Tuesday retry → success leaves neither attempt overdue. | **Closed, no regression.** |
| Workflow F5 | Lines 313 and 317 retain populated-board Create job, prefilled Plan trip, queue filters and execution-only Append reading on trip detail. Changing an existing reading/non-trip repair requires the appropriate manager action. | **Closed, no regression.** |

## Acceptance, dependencies and rollout

**DA01–DA12 adoption:** an executed text comparison confirms all twelve numbered criteria at lines 518–540 match the independent story review verbatim. Line 542 records a substantive PM disposition covering each criterion: DA01–02 intake/exclusivity; DA03 manual authorized reaction; DA04–06 physical truth/recovery; DA07–08 correction/retry integrity; DA09–11 complete mileage and defined mathematics; DA12 authorized usable surfaces and complete release. The bounded interpretations avoid new monitoring, generalized event sourcing, GPS, portals and force repair. Three clicks means entry to the task, not completion of data entry. No safety criterion was cut or deferred, and none is falsely marked executed. F-B1 concerns satisfying DA03's fail-closed requirement, not weakening that criterion.

**Complete usable increment:** section 7 ships all sixteen stories/five workflow groups together, including interruption, recovery, missing-reading repair, corrections and full-fleet reconciliation. Internal commits and later feature-spec groupings are not partial live releases. Line 504 explicitly withholds lifecycle features from pilot operators until the complete release gate. Shared UI/master/command seams remain appropriate under retained independent architecture evidence; no new platform dependency was added by the latest resolution.

**Dependency and estimate check:** C09 precedes source-dependent C03 and C08/C10 integration. C01/C02's identity/profile work does not claim to replace the source evaluator. Custody/correction and mileage integration must satisfy the complete release gate; intermediate increments can be tested before full measurement UI exists. Nineteen unsplit packages plus fourteen increments across C08/C09/C11/C14/C16/C18 yield **33**. Raw workflow contributions `7+9+5+7+6+2=36`, less shared C09=2 and C17=1, also yield 33. C24 supplements tests within owning increments. This is provisional sizing, not completed commits, time/cost certainty or a mandate to manufacture commits. Baseline/pilot collection is operating work, not another implemented feature phase.

**Rollout/rollback safety:** lines 546–553 require confirmation before feature decomposition, complete test/build/UI evidence before operator exposure, separately authorized staging/migrations, least-privilege ACL setup and isolated fixtures. The fleet manager must validate real schedules and boundary-reading practice, set timezone and freeze cohort before collecting baseline. Rollback stops new dispatch while retaining the write capability needed to finish/recover or record external outcomes for in-flight work, then removes that capability; facts and read access survive. It cannot be interpreted as reverting to a foundation binary that immediately removes every operational endpoint while cargo remains active. A concrete deployment runbook and actual rollback evidence belong to C25; no production action is authorized by this document.

**Measurable result honesty:** four baseline weeks use normal planning and the same ledger rules, followed by the proposed eight-week planning pilot. Incomplete night boundaries, resets or unknown cargo keep comparisons incomplete without preventing truthful dispatch. The frozen cohort includes disabled vehicles and zero-job days; neither a missing day nor T=0 becomes measured success. Before/after correlation is distinguished from causality and fixture arithmetic from actual fleet improvement. The numerical target/dates remain confirmation choices; the confirmed goal is fewer empty kilometres.

**Final summary:** lines 664–677 correctly state scope, 25/33 estimate, twelve adopted criteria, outstanding implementation evidence and pending user confirmation. Pending review checkboxes are honest at this snapshot. The author should carry the dispositions below into the final summary after F-B1 closure rather than claiming every historical review was originally an approval. No additional scope or architecture decision is needed to repair this finding.

## Explicit gate dispositions

| Gate | Disposition at reviewed revision | Independent basis |
|---|---|---|
| Context / identity | **PASS as App Spec context** | Retained context re-review closed C2–C5/W1–W3 at the stated consistency level; story reviewer closed R2-C1/historical warning; this review verifies their preservation and closes S-C1's reaction boundary. |
| Workflow / UX | **PASS as App Spec workflows** | Retained workflow review plus independent story closure of F1–F5; targeted traces above show no regression. This is not UI execution evidence. |
| Story / criteria | **PASS as App Spec stories** | Retained sixteen-story/path/impact audit, S-C1/S-W1 closure and verified DA01–DA12 adoption/PM challenge. Runtime invariants remain untested. |
| Architect checkpoint 1 | **CHANGES — A1 precision residual** | Checkpoint 2 independently closed A2 and most A1 source/reuse boundaries. F-B1 leaves the safe accepted-input boundary incomplete. |
| Architect checkpoint 2 | **CHANGES — B1 not fully closed** | Original B1 combinations are explicitly restricted; the seconds boundary counterexample remains permitted by the concrete minute predicate. |
| Rollout / final App Spec | **CHANGES — dependency gate** | Section 7's usable increment, acceptance, rollout/rollback and honest metrics pass this review; final readiness for user confirmation still depends on F-B1 closure. No separate rollout scope expansion requested. |

## Executed checks and limits

- Runner: **local**. No `DOCKER_COMPOSE_FILE` or local override files; development compose probe returned no running app. Fullapp probe failed interpolation because `JWT_SECRET` is unset. No environment/credentials changed.
- `git diff --check 7d2efcc41^..7d2efcc41`: exit 0, no output. Introducing revision changes only the App Spec and author resolution note. Fork-to-parent diff is empty, not evidence that there was nothing to review.
- Node **v24.19.0**, inline script via `node --input-type=module`, imported the actual `getMergedAvailabilityWindows` from `packages/core/src/modules/planner/lib/availabilityMerge.ts`: **PASS, four fixtures plus minute-boundary assertion**. Fixtures: excluded one-off still opens the day; 22:00+8h survives next-day override; the new 16:00:30+8h tail above; weekly Monday 08:00–16:00 minus 10:00–11:00 produces precisely 08:00–10:00 and 11:00–16:00. The passing assertions reproduce hazards; they do not certify the future adapter.
- Independent inline Node document checks: **PASS: 12 DA criteria verbatim; 16 stories; 16 required section markers; 33-commit arithmetic; 10 local Markdown targets.** No remote links or general application behavior were tested by these checks.
- Attempted `yarn workspace @open-mercato/core test --runInBand --runTestsByPath src/modules/planner/__tests__/availabilityMerge.test.ts src/modules/planner/__tests__/plannerAvailabilityService.test.ts`: **exit 1, blocked** with `Couldn't find the node_modules state file`. No dependencies installed. No suite/build/integration/UI pass is claimed; operational software does not yet exist. Full implementation gate remains future work.
- Only this review note is changed/committed. Staged and committed note diff/scope checks are recorded in the task report. No source-spec/runtime/schema/generated-file edits, feature specs, migrations, tracker changes, child tasks or pushes.

Review assignment complete. Required next step: author makes the small timestamp-precision clarification and adds its conformance fixture requirement, followed by targeted independent verification. All other closures above may be retained; do not restart broad discovery or treat this verdict as permission to implement.
