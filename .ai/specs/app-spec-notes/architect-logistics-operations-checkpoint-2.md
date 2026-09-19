# Logistics operations — architect checkpoint 2

Date: 2026-09-19. Verdict: **changes**. This judges App Spec architecture only, not production correctness or implementation readiness.

Reviewed `cez/32c60056` at `01dafdd3ad56dbd61c9587c1b11a02685c707a24`, also this review's fork point. Read the App Spec, checkpoint 1, commit ledger and resolution claims; inspected the checkpoint-resolution diff `01dafdd3a^..01dafdd3a` and checked `01dafdd3a..cez/32c60056` (empty). References below use that snapshot. No children, recursive skills, implementation edits, tracker mutations or pushes.

## Checkpoint 1 closure

**A2 resolved.** The ledger now distinguishes 25 work packages from 33 provisional atomic commits. Six packages expand to 14 increments: C08=2, C09=2, C11=2, C14=2, C16=3, C18=3. The other 19 remain single increments: 19+14=33. Workflow contributions in section 4 are 7+9+5+7+6+2=36; subtract shared C09=2 and C17=1 to obtain 33. The union contains exactly C01–C25. Section 6's overlapping story rows are contributions, not additive estimates; their union plus C24/C25 covers the same packages. WF3's score 4 matches five commits; workflows above five score 5. Node assertions independently confirmed workflow totals and unique accounting.

C09 precedes source-dependent C03 and C08/C10 integration in both the ledger and section 7. C02 still needs authorized identity reads; it must not independently implement the later schedule evaluator. This is normal staged integration, not an architectural dependency cycle. C24 supplements the targeted tests in every increment. The estimate remains provisional; there is no requirement to manufacture commits or cut recovery/mileage scope.

**A1 substantially addressed, but not fully closed.** Section 4.5 now names sanctioned resource/staff/planner reads, complete pagination, read authorization, optional-module failure, source versions/membership, custom-versus-linked precedence, UTC semantics and strict prevalidation. Persisted selection agrees with `AvailabilityRulesEditor.tsx:486–487`: saved subject rules take precedence; the unsaved browser flag is not a server contract. General `staff/api/team-members.ts:34` supports the personnel selector without requiring driver login accounts. The remaining problem is the accepted merger input domain below.

## B1 — Bound accepted one-off combinations before claiming safe coverage

Priority: high. App Spec lines 369–373, section 4.5; C09b and LOG-OP-01.

Two inputs allowed by the new grammar can still produce false availability. Both were executed against the actual `packages/core/src/modules/planner/lib/availabilityMerge.ts` using Node, without changing source:

1. **Excluded one-off availability still opens the day.** Rule `DTSTART:20260922T000000Z;DURATION:PT24H;FREQ=DAILY;COUNT=1`, kind `availability`, exdates `['2026-09-22']`, queried for September 22 UTC, returns `[2026-09-22T00:00Z, 2026-09-23T00:00Z)`. The top-level `overrideDays` construction at lines 183–194 does not apply exclusions; it bypasses the exclusion-aware expansion path at lines 97–98. Strictly valid EXDATE syntax therefore does not prevent this false positive.
2. **A whole-day unavailable override leaves an overnight tail.** Daily availability `DTSTART:20260921T220000Z;DURATION:PT8H;FREQ=DAILY` plus unavailability `DTSTART:20260922T000000Z;DURATION:PT24H;FREQ=DAILY;COUNT=1`, queried for September 22 UTC, returns September 21 22:00 through September 22 06:00. A 01:00–02:00 booking would pass ordinary clipped window coverage on the supposedly unavailable day. Line 204 removes windows by their start date only; a prior-day start survives. All rules satisfy the proposed duration/UTC restrictions.

**Minimal correction:** explicitly reject nonempty EXDATE on COUNT=1 rules, and reject selected rule sets combining one-off overrides with recurring windows crossing UTC midnight. These are conservative app-local supported-input restrictions; more precise rejection of only intersecting overnight/override combinations is also valid. Return unknown/unsupported with actionable source-editor guidance and add both fixtures to C09b/LOG-OP-01. No generic scheduler expansion or core modification is required. Do not silently reinterpret the returned windows as honoring exclusions or whole-day blocking. A later expansion of supported recurrence remains a separate decision.

The documented weekly Monday 08:00–16:00 UTC example with 10:00–11:00 unavailability passed an executed positive fixture. UTC/local display differences across DST are explicitly disclosed; requiring local-time recurrence now would expand the accepted scope unnecessarily.

## Architecture and boundary findings

| Area | Evidence and assessment |
|---|---|
| Existing capabilities / section 6 | Existing CRUD/commands/forms cover scaffolding, not transport custody, exclusive bookings or complete mileage reconciliation. The planner service only delegates supplied rules/range to the merger (`planner/services/plannerAvailabilityService.ts:1–23`). No missed existing capability justifies replacing this domain with sales orders, staff timesheets or workflow instances. |
| Module seams | One app module, FK IDs plus snapshots, owned profiles and sanctioned projections follow `packages/core/AGENTS.md:242–252`. Optional service resolution must degrade safely; no unconditional peer resolution or staff entity import. `staff/AGENTS.md` and `planner/api/access.ts:43–65` support explicit absence handling. |
| Source access | Resources GET requires `resources.view` (`resources/api/resources.ts:36`), personnel GET `staff.view` (`staff/api/team-members.ts:34`), both planner GETs `planner.view`. Their list fields expose scope/link/version and rule fields; page size caps are 100. Query-engine access must preserve equivalent feature checks and absence detection. Minimal projected candidates avoid leaking general personnel fields. |
| Transaction / postcommit | Section 4.5 line 375 correctly requires one outer transaction for locks, receipt and state, then emissions/indexing for all affected entities. `withAtomicFlush` joins ambient transactions and only the outer owner commits; `runCrudCommandWrite.ts:44–82` emits after its local write block, which alone does not prove an ambient commit. The spec explicitly avoids that trap. Receipt replay, current authorization and unknown-outcome recovery are appropriate; no private outbox is needed for board invalidation. |
| Proposed APIs / validation | A01–A16 separate CRUD from guarded lifecycle commands; prohibit generic writes to internal facts/reservations; require scoped references, aggregate versions, request receipts and current replay authorization. LOG-OP-04/07/10/11/14 demand real races, rollback, replay, correction and access tests. This is sufficient App Spec architecture; feature design must still prove concrete schemas and transaction behavior. |
| UI / overengineering | Shared schedule supports day/agenda and metadata (`packages/ui/src/backend/schedule/types.ts:1–24`); domain statuses need no shared contract change. Shared table/form/KPI/conflict families plus standard events and authoritative refresh fit the board. Source observations are decision evidence, not cross-module locking; append-only facts need no generalized event-sourcing engine. |

## Verification and limits

- Runner: **local**. No explicit `DOCKER_COMPOSE_FILE` or local override files. Development compose probe found no running app; fullapp probe failed interpolation of missing `JWT_SECRET`. No credentials/environment changed.
- Attempted `yarn workspace @open-mercato/core test --runInBand --runTestsByPath src/modules/planner/__tests__/availabilityMerge.test.ts src/modules/planner/__tests__/plannerAvailabilityService.test.ts`: blocked because Yarn cannot find the node_modules state file. No suite/build pass is claimed.
- Node v24.19.0 imported the actual merger and passed three source probes: positive weekly subtraction and both counterexamples above. These prove existing behavior, not a future adapter's correctness. Independent Node arithmetic assertions passed.
- `git diff --check 01dafdd3a^..01dafdd3a` and review-note diff checks passed. Only this review note is committed; no main-spec, runtime, schema, generated-file or dependency changes.

Checkpoint 2 and A1 can pass once B1 pins safe accepted combinations and the corresponding implementation fixtures. A2 is closed. No other App Spec architecture blocker was found within this review scope; approval would still not authorize implementation or certify production correctness.
