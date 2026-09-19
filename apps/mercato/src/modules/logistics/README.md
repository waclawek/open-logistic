# Logistics dispatcher panel

Two sidebar entries share the read-only `logistics.view` feature:

| Page | URL |
|---|---|
| AI inbox | `/backend/logistics` |
| AI Przewozy | `/backend/logistics/transports` |

The following legacy routes remain accessible but are hidden from navigation:

| Page | URL |
|---|---|
| Transport jobs | `/backend/logistics/transport-jobs` |
| Vehicles / drivers | `/backend/logistics/fleet` |
| Trips and routes | `/backend/logistics/trips` |
| Fleet map | `/backend/logistics/map` |
| Statistics | `/backend/logistics/statistics` |
| Proposals and disruptions | `/backend/logistics/proposals-disruptions` |

The dispatcher reads offers and transports from tenant/organization-scoped database
tables. Carrier approval/rejection, offer rejection and additional-load allocations
persist across reloads. Each accepted offer becomes the next numbered order
(Order 3, 4, 5, ...). Sales accounting and external communication are outside this
module. The six legacy pages still describe planned capabilities.

Remaining capacity is calculated separately in kg and pallet spaces, subtracting
Order 1 and all accepted additional loads. Missing Order 2 means unknown capacity.
Acceptance requires confirmed customer/carrier orders and enough room under both limits.
This foundation models a single shared transport leg, not route-segment planning.

Entities live in `data/entities.ts`, inputs in `data/validators.ts`, and writes in
the module's commands. Allocation locks both transport and offer in one transaction
and rechecks both capacity dimensions. Version headers prevent stale decisions;
mutation guards and command side effects remain active. Client calculations are
display helpers, never authority for accepting a load. Example data belongs to
`setup.seedExamples`; the browser never seeds records or falls back to fixtures.

## Enable and grant access

The module is enabled as `{ id: 'logistics', from: '@app' }` in the app's `src/modules.ts`. After deployment, run the standard app commands:

```sh
yarn generate
yarn mercato auth sync-role-acls
yarn mercato configs cache structural --all-tenants
```

Apply the module's additive migration before using the database-backed pages.
New tenants receive `logistics.view` and `logistics.manage` for the existing
administrator role through `setup.ts`. The sync command updates existing roles
additively. There is no default employee grant and no new role. Grant operators
`logistics.view` for reads and `logistics.manage` for decisions. Standard
`logistics.*` and `*` grants also apply.

To revoke access, remove every effective grant (including inherited/wildcard sources) through the existing ACL editor. The existing server-side page guards and navigation filtering enforce access using the selected tenant/organization. An already-rendered static page may remain in an open tab; subsequent requests must be authorized. No logistics-specific session or cache implementation is introduced.

To disable the module, remove its module entry, regenerate registries and clear
the structural cache. Existing logistics tables and records remain in the database.

## Verification

```sh
yarn workspace @open-mercato/app test --runInBand src/modules/logistics
yarn test:integration:ephemeral logistics
```

Integration coverage uses temporary users, roles and organizations and cleans up its fixtures. Existing Auth contract tests cover ACL management boundaries and stale-write conflicts (`TC-AUTH-051`, `TC-LOCK-OSS-031`); the logistics suite exercises access to the new pages through that standard system.

Current panel specification: `.ai/specs/2026-09-19-dispatcher-demo-panel.md`.
Original navigation specification: `.ai/specs/2026-09-19-app-spec-logistics-dashboard.md`.
