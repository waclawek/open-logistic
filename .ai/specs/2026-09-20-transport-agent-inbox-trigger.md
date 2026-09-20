# Transport-created Agent Inbox trigger

Date: 2026-09-20. Status: implemented.

## TLDR & Overview

Creating a Sales-backed client transport automatically starts the existing Logistics Agent Inbox
demo job. The transport remains the persistent source of truth; the current mock exchange, random
seed pool, in-memory run state, carrier proposal gate, and load-optimizer flow remain intact. A
small adapter overlays real transport customer, reference, price, cargo, dates, and recognizable
Polish lane locations onto the random seed so the demonstration is related to the created offer.

This MVP deliberately does not add a second transport-run database model or a new background
orchestration subsystem. Durable agent-run state and execution while no Inbox page is open are a
separate production-hardening phase.

## Problem Statement

The Agent Inbox "Start agreed-offer job" action currently starts an unrelated random offer. New
rows in AI Transports do emit `logistics.transport.created`, but nothing converts that Sales-backed
transport into an Agent Inbox run. Runs are also process-local and were not tenant/organization
scoped, which makes directly connecting the event unsafe.

## Proposed Solution

- Add scope and `sourceTransportId` to the existing in-memory `TransportRun` model.
- Add a pure adapter from `TransportDetail` to `AgreedClientOffer`. Start with the random seed,
  then override only values present on the real transport. Known demo cities reuse their real demo
  coordinates; unknown lanes retain the selected seed geography and state that fallback in notes.
- Add an idempotent `startTransportRunForTransport` service keyed by tenant, organization, and
  source transport ID.
- Add ephemeral subscribers for `logistics.transport.created` and `sales.order.created`. The
  second path covers Sales orders created through standard CRUD flows; source events remain
  persistent while projection subscribers run inline so the existing process-local Inbox can see
  the run.
- Add a Logistics command interceptor after `sales.quotes.convert_to_order`. The core conversion
  command persists an order without emitting `sales.order.created`, so the interceptor invokes the
  same scoped, idempotent run-start handler after a successful conversion. Generic Sales quotes
  are ignored because they do not load as Logistics client transports.
- Emit the additive `logistics.transport_run.started` lifecycle event after a run is created and
  refresh Agent Inbox through `useAppEvent`, not a new polling loop.
- When a human approves an Agent Inbox carrier proposal for a Sales-backed run, execute one
  Logistics transport command that atomically creates the approved Sales carrier child as Order 2.
  Persist first; only then advance the process-local run. Manual demo runs remain in-memory only.
- Keep the existing button as a demo/manual fallback, but scope its run to the current request.

## Architecture

The Sales-backed transport is authoritative. The subscriber receives only the record ID and uses
trusted event scope to load it through the existing scoped/decrypting read model. No ORM relation
is introduced. The adapter and starter live in `logistics`, and the UI consumes the existing API.

The event subscriber is intentionally ephemeral because the current Agent Inbox run store is
in-memory. A persistent worker would run in another process and create invisible state. Production
hardening must persist run snapshots first, then may switch this subscriber to persistent delivery
and enqueue agent steps.

## Data Models

`TransportRun` gains:

- `tenantId: string`
- `organizationId: string`
- `sourceTransportId: string | null`

No database schema changes are included in this MVP.

## API Contracts

Existing URLs and response envelopes remain unchanged. GET and item/action routes filter runs by
the authenticated tenant and selected organization. POST `/api/logistics/transport-runs` remains
the manual demo fallback and creates a scoped run.

## UI / Frontend Architecture Contract

`LogisticsAgentInbox` remains the existing client island. It adds one `useAppEvent` listener for
`logistics.transport_run.started` and calls the existing `load` callback. A run created from a real
Sales transport is visibly labeled with its order number, while manual seed runs are labeled as
demo jobs. A newly broadcast run is selected and shown across filters. No new component, provider,
polling loop, or bundle-heavy dependency is added.

## Migration & Backward Compatibility

All changes are additive. Existing event IDs, API routes, agent IDs, tool names, and UI locations
remain stable. The new run fields are internal to this app module. Existing manual demo behavior
continues, now with request scope. No migration or backfill is required.

## Implementation Plan

### Phase 1: Safe transport-aware run creation

1. Scope the in-memory run store and add idempotent source-transport lookup.
2. Map a real `TransportDetail` onto a random agreed-offer seed.
3. Add focused unit tests for mapping, scoping, and idempotency.

### Phase 2: Automatic Inbox refresh

1. Subscribe inline to `logistics.transport.created` and `sales.order.created` using trusted scope,
   and cover the quote-conversion command's missing CRUD event through its public interceptor hook.
2. Emit and browser-broadcast `logistics.transport_run.started` only after run creation succeeds.
3. Refresh the Agent Inbox when the event arrives.
4. Mirror app-module changes into the create-app template.

### Phase 3: Persist an approved carrier as Order 2

1. Map the selected carrier company, price, exchange reference, vehicle type, and capacity to the
   existing Sales-backed carrier order fields.
2. Create the child with `transport_role=carrier`, `transport_order_number=2`, parent transport ID,
   and `approved` status through the Logistics command layer.
3. Advance the in-memory run only after the Sales transaction succeeds; make a repeated command
   harmless when the same exchange reference is already mapped.

### Deferred production hardening

1. Persist transport-run snapshots with optimistic locking and encrypted sensitive fields.
2. Move agent stepping to an idempotent queue worker.
3. Switch run-start delivery to a persistent subscriber after state is cross-process durable.

## Integration Test Coverage

- A scoped transport-created event starts exactly one run for the source transport.
- Converting an Inbox-created transport quote starts the same run even though the core conversion
  command does not emit `sales.order.created`.
- Replaying the event returns the same run rather than duplicating it.
- A transport in another tenant or organization is not readable from the current scope.
- Real customer, reference, price, cargo, and known-city lane values override the random seed.
- Manual demo start still works and is scoped.
- Agent Inbox refreshes after the browser receives `logistics.transport_run.started`.
- Converted Sales transports show their source order number and are distinguishable from random
  demo jobs and random carrier candidates.
- Approving a real run persists the selected carrier as approved Order 2 before the agent run moves
  past the human gate; a persistence failure leaves the proposal pending.
- Approving a manual demo run does not create a Sales order.

## Risks & Impact Review

#### Process restart loses agent progress

- **Scenario**: The app restarts after a proposal has been generated.
- **Severity**: Medium
- **Affected area**: Logistics Agent Inbox demonstration state.
- **Mitigation**: Keep the manual fallback and clearly retain this as demo state; do not claim
  durable execution. The Sales transport remains persisted and unchanged.
- **Residual risk**: The demo job must be restarted after a process restart until the deferred
  persistence phase is implemented.

#### Duplicate event delivery

- **Scenario**: The same create event is observed more than once.
- **Severity**: Medium
- **Affected area**: Agent Inbox list.
- **Mitigation**: Idempotency lookup uses tenant, organization, and source transport ID.
- **Residual risk**: Process-local idempotency resets on restart, consistent with existing demo
  semantics.

#### Missing or unknown coordinates

- **Scenario**: A transport contains address text outside the known demo city catalogue.
- **Severity**: Low
- **Affected area**: Demo map and carrier search.
- **Mitigation**: Retain one valid random demo corridor while still applying commercial and cargo
  values; disclose the fallback in run notes/history.
- **Residual risk**: The map is illustrative until a geocoding provider is introduced.

#### Cross-tenant run visibility

- **Scenario**: A user guesses another run UUID.
- **Severity**: High
- **Affected area**: Agent Inbox APIs and AI tools.
- **Mitigation**: Scope every list/detail/action/tool lookup by trusted tenant and organization.
- **Residual risk**: None expected within the process-local store.

## Final Compliance Report — 2026-09-20

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/ai-assistant/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`

### Compliance Matrix

| Rule Source            | Rule                                                  | Status    | Notes                                                    |
| ---------------------- | ----------------------------------------------------- | --------- | -------------------------------------------------------- |
| root                   | Preserve tenant/organization isolation                | Compliant | Run reads and event loads use trusted scope.             |
| root                   | No direct cross-module ORM relations                  | Compliant | Scalar Sales order ID only.                              |
| events                 | Declare and consume events through module conventions | Compliant | Existing declared event plus auto-discovered subscriber. |
| queue                  | Do not invent a custom background queue               | Compliant | No new queue or polling loop; durable work is deferred.  |
| UI                     | Use event bridge instead of polling                   | Compliant | Existing client island adds `useAppEvent`.               |
| backward compatibility | Keep stable event/API/tool IDs                        | Compliant | No IDs removed or renamed.                               |

### Internal Consistency Check

| Check                           | Status | Notes                                                   |
| ------------------------------- | ------ | ------------------------------------------------------- |
| Data models match API contracts | Pass   | API envelopes stay unchanged.                           |
| API contracts match UI behavior | Pass   | UI reloads the existing list endpoint.                  |
| Risks cover write operations    | Pass   | Event replay, process loss, and scope are explicit.     |
| Commands defined for mutations  | N/A    | MVP writes only existing process-local demo projection. |
| Cache strategy covers reads     | N/A    | Existing bounded process-local store is unchanged.      |

### Verdict

Fully compliant for the explicitly scoped demo MVP; durable production orchestration remains
deferred and is not represented as complete.

### Validation

- `yarn generate` — passed; subscriber registries include both new handlers. OpenAPI generation
  used its documented fallback after a Windows `spawn EPERM`.
- `yarn tsc --noEmit --incremental false -p apps/mercato/tsconfig.json` — passed.
- Focused Logistics Jest suites cover mapping, scope/idempotency, both source events, quote
  conversion, visible source-order identity, command persistence, and endpoint ordering — 7 suites
  and 21 tests passed.
- `yarn template:sync` — passed after mirroring the app module.
- Targeted create-app `template-modules-parity.test.ts` — 3 tests passed (the sandboxed
  invocation hit Windows `spawn EPERM`; the approved retry passed).
- ESLint on changed Logistics TypeScript files — no errors; one pre-existing React ref cleanup
  warning remains in `LogisticsAgentInbox`.
- Full monorepo tests were not run to respect the user's 30-minute test-execution ceiling.

## Changelog

### 2026-09-20

- Initial specification approved by the user's autonomous overnight implementation request.
- Implemented scoped, idempotent creation from both Logistics and Sales order events, plus Inbox
  refresh and create-app template parity.
- Corrected the Inbox proposal → quote → order path by adding a post-conversion command interceptor
  because the core conversion command does not emit the normal Sales order-created event.
- Labeled converted runs with their Sales order number and auto-selected newly broadcast runs so
  operators do not confuse the source order with intentionally random carrier proposals.
- Persisted approved Agent Inbox carriers as approved Sales-backed Order 2 records through an
  idempotent Logistics transport command, before changing the in-memory run state.
