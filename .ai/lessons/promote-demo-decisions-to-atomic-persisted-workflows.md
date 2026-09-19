---
title: "Promote demo decisions to atomic persisted workflows"
modules: ["logistics"]
areas: ["module-data", "backend-ui", "testing"]
topics: ["data-integrity", "optimistic-locking", "testing"]
---

# Promote demo decisions to atomic persisted workflows

The dispatcher initially used explicitly approved demonstration records and local
React decisions. The next iteration required persistence, rejected states and
multiple numbered additional loads. Replacing an array with an API response alone
would retain the demo's fixed-load limitation and permit concurrent overbooking.

When promoting a simulation, revisit each decision's state machine and identity.
Allocate distinct offers with server-generated order numbers, validate capacity
inside a transaction, lock both the transport and selected offer, and enforce the
client's record version. Keep examples in seed hooks or test fixtures. Verify
refresh persistence, terminal rejection, repeated allocations, capacity boundaries
and simultaneous requests with self-contained API fixtures.

CRUD query schemas may be parsed more than once; boolean preprocessors must
accept their already-parsed values. Browser workflows must wait for the selected
organization to finish initializing before opening scoped details. Otherwise the
initial scope event correctly dismisses a dialog while a test is using it.
