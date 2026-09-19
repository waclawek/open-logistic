# Logistics dispatcher panel

Seven backend pages share the read-only `logistics.view` feature:

| Page | URL |
|---|---|
| Dispatcher panel — AI Inbox / AI Transports | `/backend/logistics` |
| Transport jobs | `/backend/logistics/transport-jobs` |
| Vehicles / drivers | `/backend/logistics/fleet` |
| Trips and routes | `/backend/logistics/trips` |
| Fleet map | `/backend/logistics/map` |
| Statistics | `/backend/logistics/statistics` |
| Proposals and disruptions | `/backend/logistics/proposals-disruptions` |

The dispatcher panel contains searchable demo offers and transports, offer details,
and paired Order 1 / Order 2 details with carrier, vehicle and remaining capacity.
Carrier approval and additional-load acceptance are **session-only simulations**:
refreshing the page or choosing Reset demo restores the fixtures. No real sales
orders are created, messages sent, or vehicles reserved. A visible demo notice
explains this behavior. The other six pages still describe planned capabilities.

Remaining capacity is calculated separately in kg and pallet spaces, subtracting
Order 1 and all accepted additional loads. Missing Order 2 means unknown capacity.
Demo acceptance requires an approved carrier and enough room under both limits.
This foundation models a single shared transport leg, not route-segment planning.

Data and calculations live in `lib/dispatcher-data.ts`; the client panel and details
live in `components/DispatcherPanel.tsx` and `components/TransportDetails.tsx`.
Replace the fixture/state boundary with tenant-scoped APIs, mutation guards and
optimistic locking when implementing persistence. The demo Order 2 does not imply
a decision to represent carrier costs as Sales orders.

## Enable and grant access

The module is enabled as `{ id: 'logistics', from: '@app' }` in the app's `src/modules.ts`. After deployment, run the standard app commands:

```sh
yarn generate
yarn mercato auth sync-role-acls
yarn mercato configs cache structural --all-tenants
```

New tenants receive `logistics.view` for the existing administrator role through `setup.ts`. The sync command updates existing roles additively. There is no default employee grant and no new role. Use the existing role Access editor to grant an operator `logistics.view`; this feature does not grant ACL management. Standard `logistics.*` and `*` grants also apply.

To revoke access, remove every effective grant (including inherited/wildcard sources) through the existing ACL editor. The existing server-side page guards and navigation filtering enforce access using the selected tenant/organization. An already-rendered static page may remain in an open tab; subsequent requests must be authorized. No logistics-specific session or cache implementation is introduced.

To disable the foundation, remove its module entry, regenerate registries and clear the structural cache. No logistics tables or migrations exist.

## Verification

```sh
yarn workspace @open-mercato/app test --runInBand src/modules/logistics
yarn test:integration:ephemeral logistics
```

Integration coverage uses temporary users, roles and organizations and cleans up its fixtures. Existing Auth contract tests cover ACL management boundaries and stale-write conflicts (`TC-AUTH-051`, `TC-LOCK-OSS-031`); the logistics suite exercises access to the new pages through that standard system.

Current panel specification: `.ai/specs/2026-09-19-dispatcher-demo-panel.md`.
Original navigation specification: `.ai/specs/2026-09-19-app-spec-logistics-dashboard.md`.
