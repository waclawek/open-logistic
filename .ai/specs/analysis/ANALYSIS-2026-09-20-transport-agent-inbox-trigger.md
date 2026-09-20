# Pre-Implementation Analysis: Transport-created Agent Inbox trigger

## Executive Summary

Ready to implement as an app-level demo integration. The critical correction is tenant-scoping the
existing process-local run store before subscribing it to transport creation. Durable run state and
headless agent execution must remain explicitly deferred rather than approximated with a custom
poller or cross-process in-memory worker.

## Backward Compatibility

### Violations Found

None. The design adds fields and behavior without renaming or removing any of the 13 protected
contract surfaces.

### Missing BC Section

Present in the target spec.

## Spec Completeness

No blocking sections are missing. The production persistence phase is intentionally separated from
the presentation MVP.

## AGENTS.md Compliance

No blocking violations. The subscriber uses trusted event scope, stays idempotent within the
existing store lifetime, and avoids a queue worker until state is cross-process durable.

## Risk Assessment

### High Risks

| Risk                    | Impact               | Mitigation                                                               |
| ----------------------- | -------------------- | ------------------------------------------------------------------------ |
| Cross-tenant run access | Tenant data exposure | Scope list/detail/action/tool access by trusted tenant and organization. |

### Medium Risks

| Risk            | Impact               | Mitigation                                                      |
| --------------- | -------------------- | --------------------------------------------------------------- |
| Duplicate event | Duplicate demo jobs  | Source transport idempotency key.                               |
| Process restart | Demo progress resets | Honest demo boundary and manual fallback; persistence deferred. |

### Low Risks

| Risk                        | Impact                                  | Mitigation                                          |
| --------------------------- | --------------------------------------- | --------------------------------------------------- |
| Unknown address coordinates | Illustrative route differs from address | Retain valid random corridor and disclose fallback. |

## Gap Analysis

### Critical Gaps (Block Implementation)

- None after adding trusted scope to the in-memory store contract.

### Important Gaps (Should Address)

- Unit tests for mapping, idempotency, and scope.
- Browser event refresh test.

### Nice-to-Have Gaps

- Persisted run snapshots and queue-driven agent steps, deferred by design.

## Remediation Plan

### Before Implementation (Must Do)

1. Add scope and source transport identity to `TransportRun`.
2. Define the transport-to-agreed-offer adapter.

### During Implementation (Add to Spec)

1. Record exact tests and runner.

### Post-Implementation (Follow Up)

1. Implement durable state before changing the subscriber to persistent delivery.

## Recommendation

Ready to implement.
