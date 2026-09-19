# Sales-backed logistics dispatcher

| View | URL | Required feature |
|---|---|---|
| AI Inbox redirect | `/backend/logistics` or `/backend/logistics/ai-inbox` → `/backend/inbox-ops` | `logistics.view` and `inbox_ops.proposals.view` |
| Transports | `/backend/logistics/transports` | `logistics.view` |
| Transport details and decisions | `/backend/logistics/transports/:id` | `logistics.view`; decisions also `logistics.manage` |
| Development webhook diagnostics | `/backend/trans_inbox` | `trans_inbox.view` |

The transport source is Sales orders with logistics custom fields. Order 1 is the
customer order, Order 2 is the current carrier order, and Order 3 onward are
additional-load orders linked by `transport_parent_id`. Carrier replacements retain
rejected history. Offers remain persistent LogisticsOffer records. Accepted offers
produce Sales additional-load orders; rejected offers cannot be allocated.

The detail page shows customer/carrier prices, vehicle, kg and pallet capacity,
pickup/delivery, source, carrier history and additional loads. Approval/rejection and
subsequent loads persist across reloads. Remaining capacity subtracts the customer's
cargo plus approved loads independently in kg and pallets. This models one shared
transport leg. It does not model capacity separately for different route segments.

Decisions require a confirmed customer order, an approved carrier and sufficient
capacity in both dimensions. Server transactions lock the aggregate and selected
offer; optimistic version headers detect stale decisions, including child changes
made in Sales. Mutations retain guards and audit side effects. Composed Sales events,
notifications and indexing are released after commit and discarded after rollback.
The prices are transport custom fields; the panel does not create invoice lines or
settlement documents.

The two visible navigation entries use `/backend/logistics/ai-inbox` and
`/backend/logistics/transports`; the root URL remains a hidden redirect alias.

Legacy URLs `transport-jobs`, `fleet`, `trips`, `map`, `statistics` and
`proposals-disruptions` remain accessible under `/backend/logistics` and continue to
show planned capabilities. They are hidden from navigation.

## Enable and configure

The app registers `{ id: 'logistics', from: '@app' }`. Deploy its migrations through
the normal reviewed database rollout, then regenerate and synchronize definitions:

```sh
yarn generate
yarn mercato entities install --tenant <tenant-id> --no-global
yarn mercato auth sync-role-acls
yarn mercato configs cache structural --all-tenants
```

Each organization needs an active Sales channel and order statuses `confirmed`,
`pending_approval`, `approved`, and `rejected`. Configure these in Sales settings.
A missing channel or status returns the setup-required error; business requests do
not silently change Sales configuration. Optional explicit demo seeding is available:

```sh
yarn mercato logistics seed-examples --tenant <tenant-id> --org <organization-id>
```

New administrator roles receive logistics read/manage grants. The `dyspozytor`
default feature mapping also includes Sales order reads and AI Inbox reads; it does
not grant access by role name or create a new authorization mechanism. Existing roles
need ACL synchronization. Grant `inbox_ops.proposals.view` independently to users who
need AI Inbox. Read/write requests always use the authorized selected organization.
Wildcard grants work through the standard RBAC system.

## Existing persisted transports

The legacy `logistics_transports` table and migration history remain intact. Existing
rows do not appear in the new Sales view until explicitly converted. Convert existing
records before adding new demo examples. Seeding skips references still present in the
legacy table to avoid collisions with later conversion. First review:

```sh
yarn mercato logistics migrate-sales --tenant <tenant-id> --org <organization-id> --channel <sales-channel-id>
```

The default is **dry-run**. After reviewing the plan and taking the normal backup,
apply the same command with `--apply`. `--dry-run` always wins over `--apply`.
Conversion preserves the legacy rows, records stable source identifiers, carries over
additional loads and remaps allocated offers. Repeated runs skip already converted
transports. If an imported Sales transport is deliberately deleted, a later explicit
`--apply` can import that retained legacy source again. Conversion is scoped to the supplied tenant and organization. No data
conversion is run automatically when a user opens the panel.

The existing offer APIs and collection create/delete compatibility routes remain.
Transport reads now return Sales-backed rows; rich detail is available separately at
`GET /api/logistics/transports/:id`. Use the returned aggregate `updatedAt` for decision
headers and pass its `transportVersion` in decision/proposal payloads. The fingerprint
also detects a child order being removed in Sales. Do not reuse a child order version
for the entire transport. The current list read model supports up to 1000 active
transports per organization; direct detail links remain available above that limit.

## Demonstration integrations

The separate [webhook diagnostic module](../trans_inbox/README.md) receives synthetic
Trans.eu, TIMOCOM and Eurodebt simulator traffic. It does not turn webhook bodies into
business orders. See [the simulator playbook](../../../../../.ai/docs/exchange-simulators-agent-playbook.md)
and `tools/` for commands. GraphHopper is an independent car-routing demonstration,
not a production truck-routing integration.

## Verification

```sh
yarn workspace @open-mercato/app test --runInBand src/modules/logistics
yarn test:integration:ephemeral logistics
```

Integration tests create their own organizations, users, roles, Sales configuration,
orders and offers, then clean up fixtures. Tests cover navigation and permissions,
Sales persistence, repeated loads, stale and concurrent decisions, scope isolation,
carrier replacement, rollback and idempotent legacy conversion.

Current specification: `.ai/specs/2026-09-19-sales-backed-dispatcher-panel.md`.
Earlier navigation and dispatcher specs are retained as implementation history.

### Custom-field labels

Sales custom-field labels are initialized from the English dictionary and stored as editable configuration in Sales custom-field settings. They are not runtime translation keys. Dispatcher screens use the selected language from the five supported locales (English, Polish, German, Spanish and Korean). Group headings and validation messages use the existing runtime translation support.
