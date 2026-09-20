# Sales-backed logistics dispatcher

| View | URL | Required feature |
|---|---|---|
| AI Inbox redirect | `/backend/logistics` or `/backend/logistics/ai-inbox` → `/backend/inbox-ops` | `logistics.view` and `inbox_ops.proposals.view` |
| Transports | `/backend/logistics/transports` | `logistics.view` |
| Transport details and decisions | `/backend/logistics/transports/:id` | `logistics.view`; decisions also `logistics.manage` |
| Development webhook diagnostics | `/backend/trans_inbox` | `trans_inbox.view` |

The transport source is Sales orders. Existing records use Logistics custom fields;
Inbox-created client quotes use a versioned `metadata.logistics` envelope that the
standard Sales Quote → Order conversion copies unchanged. AI Transports reads both
forms. Order 1 is the customer order, Order 2 is the current carrier order, and
Order 3 onward are additional-load orders linked by `transport_parent_id`. Carrier
replacements retain rejected history. Offers remain persistent LogisticsOffer
records. Accepted offers produce Sales additional-load orders; rejected offers
cannot be allocated.

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

The Logistics group contains the canonical Inbox Ops **Proposals** page at
`/backend/inbox-ops`, plus `/backend/logistics/transports` and
`/backend/logistics/proposals-disruptions`. An app-level route metadata override
places Inbox Ops list, detail, settings, and log pages in the Logistics group without
coupling the reusable core module to Logistics. The root URL and
`/backend/logistics/ai-inbox` remain hidden redirect aliases.

Transport RFQs keep the standard Inbox `create_quote` action. The Logistics app
adds extraction guidance for pickup/delivery, windows, cargo and customer price,
then a command interceptor attaches `metadata.logistics` before the existing
`sales.quotes.create` command runs. The internal version, kind and client role are
system-assigned; they are not inferred from customer text. No Sales package source
or separate transport entity is required.

Legacy URLs `fleet`, `trips`, `map`, and `statistics` remain accessible under
`/backend/logistics` and continue to show planned capabilities. They are hidden from
navigation. `/backend/logistics/transport-jobs` hosts a separate process-local
GraphHopper and Trans inbox demonstration and does not create Sales-backed transports.

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

The transport-jobs demo uses the live GraphHopper service on port 8989 when available
and falls back to the committed Warszawa-to-Poznań route fixture. Creating a demo
order also posts it to the development Trans inbox. The matching simulator scenario
can be sent with:

```sh
TARGET_BASE_URL=http://127.0.0.1:3000 \
TRANS_INBOX_TOKEN=<same-random-token-as-the-server> \
yarn trans:sim run tools/trans-api-simulator/scenarios/waw-poz-order.yaml
```

The demo API is `GET|POST|DELETE /api/logistics/orders` and requires
`logistics.view`.

The prototype exchange API under `/api/logistics/exchange/*` provides an endpoint
catalog, offer acceptance, carrier searches, nearby vehicles and route-corridor
backloads for the process-local demo. The Carrier Finder
(`logistics.carrier_finder`) and Load Optimizer (`logistics.load_optimizer`) agents
use the same demo model. Their background transport runs and human-approval cards are
available at `/backend/logistics/proposals-disruptions` through
`/api/logistics/transport-runs/*`. This prototype is separate from the persisted
Sales-backed transport and decision workflow described above.

See [the simulator playbook](../../../../../.ai/docs/exchange-simulators-agent-playbook.md)
and [the agent evaluation inputs](../../../../../.ai/docs/logistics-agent-evaluation-inputs.md)
for the endpoint map, scenarios, model configuration and known production gaps.

## Email to priced quote

An inbound freight enquiry becomes a draft sales quote in four steps. Nothing is
automatic past step two: a person accepts the proposed action and that is what
creates the document.

1. `offers-send-email` signs a JSON payload and POSTs it to core's inbound
   webhook at `/api/inbox_ops/webhook/inbound`. Core parses it, deduplicates it,
   writes the `inbox_emails` row and emits `inbox_ops.email.received`.
2. The subscriber `logistics:offer-freight-extraction` claims the email, calls
   the configured model with a schema that has no money field anywhere, and
   writes one proposal carrying one pending `draft_offer` action.
3. A human accepts that action at `/backend/inbox-ops/proposals/:id`. The action
   requires `logistics.offers.draft`.
4. Acceptance prices every line from `catalog_product_variant_prices`, in code,
   and creates a draft quote through `sales.quotes.create`.

Four rules hold the flow together, each pinned by a unit test under
`__tests__/offer-*.test.ts`:

| Rule | Where it lives |
|---|---|
| No price field ever reaches the model | `lib/offer-automation/freightExtraction.ts` |
| Prices come from the catalogue, after a human accepts | `lib/offer-automation/catalogPricing.ts`, `lib/offer-automation/draftOffer.ts` |
| One unpriceable line fails the whole action, writing nothing | `lib/offer-automation/catalogPricing.ts` |
| Every write carries a resolved tenant, organization and user | `lib/offer-automation/draftOffer.ts` |

Core's own extraction worker is disabled for this app in
`apps/mercato/src/modules.ts`. It cannot propose a `draft_offer` (its output
schema pins the action type to nine built-ins) and it races this subscriber for
the same email, so leaving both on makes the outcome a coin toss.

### Running it

```sh
# once per machine: INBOX_OPS_WEBHOOK_SECRET=<long random string> in apps/mercato/.env
yarn mercato logistics offers-prepare --tenant <tenantId> --org <organizationId>
yarn mercato auth sync-role-acls --tenant <tenantId>
yarn mercato logistics offers-check-ai
yarn dev
yarn mercato logistics offers-send-email --tenant <tenantId> --org <organizationId>
```

`offers-prepare` is idempotent. It seeds four freight services
(`FRT-FTL-SHIPMENT`, `FRT-LTL-PALLET`, `FRT-ROAD-KM`, `FRT-ACC-TAILLIFT`) with
EUR list prices, writes the inbox address `quotes@logistics.example`, and creates
the scoped automation account `offer-automation@logistics.example` holding one
ACL feature. Anything else it finds missing is reported, not created.

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
