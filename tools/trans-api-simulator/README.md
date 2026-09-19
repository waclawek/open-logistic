# Trans.eu API Simulator

Load / traffic generator for the Trans.eu OpenAPI under `trans_api_doc/`.
Fires mock payloads at Open Mercato (or a local Trans mock server), with **named batches** and **schedules**.

## What the API is (quick map)

| Spec | Ops | Role |
|------|-----|------|
| `auth-api` | 2 | `api-key` → access token, token exchange |
| `freights-api` | 54 | Freight CRUD, publish channels, offers, proposals |
| `orders-api` | 23 | Created/received orders, costs, transport |
| `partners-api` | 11 | Partner list / block / unblock |
| `vehicles-api` | 6 | Fleet vehicles |
| `contracts-api` | 34 | Contracts |
| `dock-scheduler-api` | 23 | Warehouses, slots, announcements |
| `openapi-public.yml` | 154 | Aggregated public surface |

Auth model: `api-key` header for token mint, then `Authorization: Bearer …` on the rest.
Base URL in the specs: `https://api.platform.trans.eu`.

This tool does **not** call production Trans.eu by default. You point `target.baseUrl` at:

1. **Open Mercato webhook sinks** via `pathMap` (Trans op → local `/api/...`)
2. **Local mock Trans** (`yarn trans:sim mock-server`) with `passthrough: true`

## Commands

```bash
# Index all Trans ops from YAML
yarn trans:sim catalog
yarn trans:sim catalog --api freights-api --q offer

# Built-in body templates
yarn trans:sim templates

# Dry-run a scenario (no HTTP)
yarn trans:sim run tools/trans-api-simulator/scenarios/smoke.yaml --dry-run

# Fire at OM (set sink URL + token)
TARGET_BASE_URL=http://127.0.0.1:3000 \
TRANS_SIM_TOKEN=… \
  yarn trans:sim run tools/trans-api-simulator/scenarios/load-freights.yaml

# Interval / cron schedules
yarn trans:sim run tools/trans-api-simulator/scenarios/scheduled-mixed.yaml
yarn trans:sim run tools/trans-api-simulator/scenarios/cron-hourly-storm.yaml

# Fake Trans.eu for pull-based adapters
yarn trans:sim mock-server --port 4099
yarn trans:sim run tools/trans-api-simulator/scenarios/against-mock-trans.yaml
```

## Scenario schema

```yaml
name: my-load
target:
  baseUrl: ${TARGET_BASE_URL:-http://127.0.0.1:3000}
  headers:
    Authorization: Bearer ${TRANS_SIM_TOKEN}
  # Rewrite Trans paths → OM routes
  pathMap:
    "POST /ext/freights-api/v2/freights": /api/integrations/trans/webhooks/freight
  # Or keep Trans paths (for mock-server / real proxy):
  # passthrough: true
defaults:
  concurrency: 20
  rps: 50
  timeoutMs: 15000
  retries: 1
  dryRun: false
schedule:                 # optional
  mode: interval          # once | interval | cron | at
  every: 30s              # interval
  maxRuns: 10
  # mode: cron
  # expression: "*/5 * * * *"
  # mode: at
  # at: "2026-09-19T12:00:00Z"
batches:
  - id: freights
    count: 100
    concurrency: 25
    template: freight.create.public   # implies default operation
    vars: { currency: eur }
  - id: custom
    count: 10
    operation: POST /ext/partners-api/v1/partners
    template: partner.add
    body: { office_id: 1028504 }      # deep-merged over template
    pathParams: { id: "$seq" }
    staggerMs: 5
parallelBatches: false
reportPath: tools/trans-api-simulator/.reports/my-load.ndjson
```

### Templates

| Template | Default Trans op |
|----------|------------------|
| `freight.create.public` | `POST /ext/freights-api/v2/freights` |
| `freight.create.companies` | `POST /ext/freights-api/v2/freight-companies` |
| `freight.event.created` | webhook-shaped freight event |
| `order.create` / `order.event.created` | `POST /ext/orders-api/v1/orders` |
| `partner.add` | `POST /ext/partners-api/v1/partners` |
| `vehicle.create` | `POST /ext/vehicles-api/v1/vehicles` |
| `dock.announcement` | `POST /ext/dock-scheduler-api/v2/announcement` |
| `none` | no body |

Add new ones in `src/generators/`.

## Reports

NDJSON: one `stats` line + one `result` line per request under `.reports/`.

## Notes

- Path map keys must match catalog keys exactly (`yarn trans:sim catalog`).
- Until OM has real Trans webhook routes, use `--dry-run` or point `pathMap` at any sink you stand up (even a `nc`/`http-echo`).
- `mock-server` answers every catalogued Trans path with plausible JSON so pull adapters can be developed offline.
