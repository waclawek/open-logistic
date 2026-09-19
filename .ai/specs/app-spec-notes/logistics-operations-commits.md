# Logistics operations — proposed atomic commit ledger

Source: [operational App Spec](../2026-09-19-app-spec-logistics-operations.md). Estimate only; these are not completed implementation commits or independently releasable workflow phases. All 25 work packages form one usable release and provisionally require 33 atomic commits, using the explicit splits below. Every atomic increment includes relevant unit/API/UI tests and translations, with integration fixtures self-contained.

| Work package | Scope (atomic splits below) | Evidence required | Main workflow |
|---|---|---|---|
| C01 | Vehicle/driver profile entities, owned extensions and migration/snapshot | Only intended schema changes; unique scoped master references and version columns | WF1 |
| C02 | Profile CRUD commands/APIs, validation and ACL | Scope, source ownership, conflicts and capacity validation tests | WF1 |
| C03 | Fleet profile forms/list and master links | Create/edit/disable with read-only and missing-source states | WF1 |
| C04 | Transport job entities, CRUD/accept/cancel commands and APIs | Input, state and scope tests; original promises preserved | WF1 |
| C05 | Job entry/list/detail and ready queue | Job acceptance flow including invalid data, conflict and permissions | WF1 |
| C06 | Trip/stop/membership/plan-revision entities and draft APIs | Ordered stop model and versioned draft validation | WF2 |
| C07 | Trip planning UI and load preview | Multiple jobs; pickup-before-delivery and intermediate-capacity errors | WF2 |
| C08 | Atomic assignment/occupancy, command receipts and booking actions | Concurrent overlapping bookings; rollback; retry outcomes | WF2 |
| C09 | Source observation/eligibility adapter | Complete source/rule-set coverage, changed source membership, unsupported rules and absent-module tests | WF1/WF2 |
| C10 | Confirm/replan/unassign and promise revisions | Failed replan retains booking; retries/windows preserve history | WF2 |
| C11 | Execution facts, custody and lifecycle command/API actions | Start/pickup/delivery/finish ordering, scope, replay and active occupancy | WF3 |
| C12 | Trip execution detail/actions/history | Complete happy path and missing-reading/late-report paths | WF3 |
| C13 | Disruption queue, retry/return and failed-attempt handling | Preserve failed stops, revised promise, cargo on return and truthful closure | WF4 |
| C14 | Recovery handover/interruption and resource releases | Multi-job all-or-none transfer, competing transfer, same-driver handover | WF4 |
| C15 | Recovery UI and linked source/target history | Manager-only full recovery with actionable conflict/validation states | WF4 |
| C16 | Typed correction/void action and guarded UI | No fact/leg branching, no contradictions with later history, recalculation invalidation | WF4 |
| C17 | Trip odometer boundaries and non-trip mileage ledger | Incoming/outgoing load distinction, non-trip distance, missing/duplicate readings | WF3/WF5 |
| C18 | Vehicle-day envelopes and reconciliation UI/API | Gaps/overlaps/midnight evidence, no-movement days, unknown classification | WF5 |
| C19 | Frozen cohorts, ledger timezone and metric calculation APIs | Complete-only ratio/relative change, fixed denominator and late correction | WF5 |
| C20 | Statistics and measurement setup UI | Coverage/missing-data drill-down; no fake improvement on empty/incomplete data | WF5 |
| C21 | Board/selector query projections and scoped aggregates | Aggregate counts across pages, source observation age, identical filter drill-through | WF2 |
| C22 | Operational dashboard composition | Ready jobs + trips + exceptions, mobile/keyboard and no-access states | WF2 |
| C23 | Standard event invalidation/refresh and retry visibility | Lost/delayed event fallback, post-commit unknown outcome, no cross-org stale response | WF3 |
| C24 | Full cross-workflow adversarial integration coverage | Simultaneous booking, recovery/correction races, org isolation and optional-source absence | All |
| C25 | Deployment/pilot runbook and complete release verification evidence | Ordered configured validation gate, actual UI QA, baseline collection instructions | All |

All work is app scope except documentation and normal generated/template parity artifacts required by repository conventions. No core/platform edits are estimated. C24 is additional cross-flow validation; it does not defer tests required by C01–C23. API actions and field names remain governed by the App Spec; feature-spec decomposition may regroup commits after final confirmation.

## Atomic sizing after architect checkpoint 1

Every unlisted work package is provisionally one commit (19 total). Split these six packages into 14 commits, for **33 total**, within the reviewer's 31–35 estimate:

| Package | Atomic increments, each with its targeted tests | Count |
|---|---|---|
| C08 | C08a reservation/job serialization and conflict APIs; C08b active occupancy + atomic command receipts/replay | 2 |
| C09 | C09a authorized complete projections, precedence, absence and versions; C09b strict supported-rule validation and interval coverage/observation integration | 2 |
| C11 | C11a typed fact stream and custody actions; C11b start/finish/resource release lifecycle and receipt integration | 2 |
| C14 | C14a receiver plan and atomic whole-job custody handover; C14b source interruption and independent resource release/reacquire | 2 |
| C16 | C16a typed successor/void model and validation; C16b serialized downstream consequences/reconciliation invalidation; C16c guarded correction UI and error paths | 3 |
| C18 | C18a versioned day-envelope model and entry APIs; C18b exact reconciliation/provenance/conflict computation; C18c reconciliation UI and missing-data repair | 3 |

Sequence C09 before the source-dependent C03 eligibility integration and C08/C10 confirmation integration. These are testable internal increments, not standalone promises that partial custody or recovery can go live. An implementation readiness audit can revise the estimate; the count is neither a delivery date nor a requirement to manufacture commits.

## Implementation evidence � 2026-09-19

Initial ordinary ready-job load-plan validation merged from independently scoped task 2a9aad3c (88cdb7845). Parent reran 59 focused adversarial cases, strict planning compilation (including tests, no skipLibCheck) and all logistics unit suites: 369 tests across 13 suites passed. Normal app typechecking passed. This covers pickup/delivery pairing, final empty end, exact payload and pallet capacity after every stop. It does not authorize dispatch or cover trip persistence, timing, reservations, source eligibility, recovery or execution; those remain required.
