# Dispatcher demo panel

Date: 2026-09-19. Status: demo implemented; browser QA pending.

## TLDR and scope

Deliver a usable demo foundation at `/backend/logistics` with two tabs: AI Inbox
(offers) and AI Transports (transports with Order 1 and Order 2). The user explicitly
chose demonstration data for a fast first iteration. This supersedes the static
dashboard portion of `2026-09-19-app-spec-logistics-dashboard.md`; its six other
routes and existing access controls remain available.

The product brief on `juliajakubowskabiznes:docs/scope-cut-product-brief` supplies
the business vocabulary. Its proposed module deletion and use of Sales records
are not part of this UI demo. No existing module or template is deleted.

## Behavior and data model

- Offer: customer, route, loading/unloading dates, cargo, price, source and status.
- Transport: customer, route, dates, exactly one Order 1 and an optional Order 2.
- Order 1: customer order reference, status and cargo.
- Order 2: carrier order reference, status, carrier and vehicle snapshot.
- Vehicle: registration, type, maximum cargo weight in kg and pallet spaces.
- Remaining capacity is calculated separately for weight and pallets: vehicle
  capacity minus Order 1 cargo minus all accepted additional loads.
- Missing Order 2 means unknown capacity. Negative remaining capacity is an
  overload, never permission to accept cargo.
- A demo carrier can be approved. A fixed demo additional load can be accepted
  once per transport, only after carrier approval and within BOTH limits.
- Demo decisions are immutable local React state, reset by refresh or Reset demo.
  They never create sales orders, send messages, reserve a real vehicle or write
  to a database. A visible notice communicates this behavior.
- Search filters offers/transports. Each row has keyboard-accessible details.
  Escape closes dialogs; Ctrl/Cmd+Enter invokes the available primary demo action.

## Architecture and frontend contract

The existing guarded server route mounts one client island, `DispatcherPanel`.
It owns tab/search/selection/demo state; `TransportDetails` renders the selected
transport. Pure typed fixture/calculation utilities live in `lib/dispatcher-data`.
Use existing DataTable, Tabs, Dialog, SectionHeader, Alert, StatusBadge and Button.
No global providers, production dependencies, background polling or network data
requests are introduced. Only the active tab and selected detail are mounted.
The bounded three-row fixtures need no pagination or virtualization. No new heavy
chart/editor/map dependency is permitted. Translations cover all module locales.

## API contracts, security and compatibility

No API, persistence, ORM entity, migration or new permissions. Existing
`requireAuth` and `logistics.view` guard the page. All fixtures are fictional and
contain no tenant data. Optimistic locking and API mutation guards will be required
when real writes replace the local simulation; there is no editable persisted
entity in this phase. Existing URLs and ACL IDs remain stable. No change to Sales
accounting semantics is implied by the demonstration Order 2 object.

## Validation and risks

- Unit coverage: capacity in both units, prior loads, missing carrier, overload,
  invalid cargo, confirmation requirement and idempotent demo decisions.
- UI/integration coverage: both tabs, search/empty result, offer and transport
  details, carrier approval, additional load, reset/refresh, keyboard dismissal,
  existing auth guards, translations and mobile layout. Integration auth fixtures
  are isolated; business fixtures are delivered by this demo, not database seeds.
- Run generators, relevant Jest tests, DS lint and build/type checks where the
  local runtime permits. Record unavailable checks rather than claiming a pass.
- Risk: demo mistaken for persistence. Mitigation: persistent demo notice and
  explicit session behavior; no integration capable of external effects.
- Risk: demo capacity mistaken for route planning. This phase models one shared
  transport leg; route-segment occupancy is deferred to real transport planning.

## Changelog

- 2026-09-19: User approved demonstration data and a fast two-tab foundation.
- 2026-09-19: Implemented searchable tabs, offer/order details, session-only
  decisions, separate kg/pallet capacity checks, reset and keyboard focus return.
  Preserved the six legacy routes and existing authorization metadata.

## Validation record

Runner: local (no running Compose app container).

- Module Jest suite: 3 suites, 62 tests passed. UI tests exercise real tabs,
  dialogs and details; the shared DataTable is mocked at the boundary.
- App typecheck and targeted DS lint: passed.
- Package build: passed after rebuilding cached artifacts for this checkout.
- Full application build: passed (Next.js compilation, TypeScript and page
  generation); existing filesystem-tracing warnings remain outside this module.
- `yarn generate`: completed; the existing OpenAPI bundler used its static
  fallback after a third-party JSON import-attribute error. No API was added.
- Hardcoded-string scan: no findings. All five locale dictionaries contain the
  same keys; value coverage reports no missing translations.
- Browser integration scenario added with isolated auth fixtures; not yet run
  against a prepared application. No claim of browser/visual QA completion.
