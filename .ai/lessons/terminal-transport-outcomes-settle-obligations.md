---
title: "Terminal transport outcomes must settle obligations separately from mileage"
modules: ["logistics"]
areas: ["architecture","spec-pr"]
topics: ["domain-modeling","state-transitions","data-integrity"]
---

# Terminal transport outcomes must settle obligations separately from mileage

**Context:** Independent reviews of the 2026-09-19 logistics operational App Spec found two deadlocks: an interrupted source trip could retain an unpicked assigned job after handing over its onboard cargo, and wording about a missing odometer could prevent an actual delivery from ending custody.

**Rule:** Specify a terminal predicate for every physical trip outcome, including recovery outcomes: no remaining cargo custody and no active unperformed obligation. Explicitly release/cancel unpicked jobs, close their memberships and skip their future stops before or atomically with interruption. Historical memberships must not keep current jobs assigned to a terminal trip. A valid physical delivery/return changes custody even when mileage evidence is missing; measurement remains incomplete independently.

**Evidence:** `.ai/specs/app-spec-notes/challenger-logistics-operations-context-r2.md` (A onboard, B unpicked counterexample), `challenger-logistics-operations-workflows.md` (delivery without odometer), and the operational App Spec's interruption and missing-reading rules. These are specification traces, not executed implementation tests.

**Applies to:** Transport lifecycle/recovery design and acceptance tests. Verify both normal completion and interruption with mixed collected/uncollected jobs, and verify missing measurement does not force false physical facts.
