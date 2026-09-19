# TIMOCOM Freight Exchange API Simulator

> Application capture requires development mode, explicit enablement, configured tenant/organization and X-Trans-Inbox-Token. Set TRANS_INBOX_TOKEN in the simulator terminal. See [diagnostic inbox setup](../../apps/mercato/src/modules/trans_inbox/README.md). Provider authorization headers below are simulated and do not authenticate the diagnostic inbox.

Load / traffic generator for the TIMOCOM Freight Exchange API v3
([developer portal](https://developer.timocom.com/), OpenAPI in `timocom_api_doc/freight-exchange-openapi.yaml`).

Mirrors `tools/trans-api-simulator` — batches, schedules, mock server — aimed at Open Mercato's live inbox.

## API map (v3.0.6)

| Area | Ops |
|------|-----|
| Enumerations | country, currency, vehicle properties, … |
| Freight offers | publish / search / lookup / withdraw |
| Vehicle space offers | publish / search / lookup / withdraw |
| Freight quotes | create / lookup / withdraw |
| Closed freight exchange policies | publisher / searcher |

Auth: **Basic** (`group:password`). Content-Type: `application/vnd.freight-exchange.v3+json`.  
Servers: `https://api.timocom.com/freight-exchange/3` / `https://sandbox.timocom.com/freight-exchange/3`.

## Commands

```bash
yarn timocom:sim catalog
yarn timocom:sim templates
yarn timocom:sim run tools/timocom-api-simulator/scenarios/smoke.yaml --dry-run

# Local fake TIMOCOM
yarn timocom:sim mock-server --port 4100
yarn timocom:sim run tools/timocom-api-simulator/scenarios/against-mock-timocom.yaml

# Into OM live inbox (/backend/trans_inbox)
TARGET_BASE_URL=http://127.0.0.1:3000 \
TRANS_INBOX_TOKEN=<shared-diagnostic-token> \
  yarn timocom:sim run tools/timocom-api-simulator/scenarios/smoke.yaml
```

Webhook sink: `POST /api/integrations/timocom/webhooks/{freight-offer|vehicle-space|freight-search}`

## Templates

| Template | Default op |
|----------|------------|
| `freight.offer.publish` | `POST /freight-exchange/3/my-freight-offers` |
| `freight.offer.search` | `POST /freight-exchange/3/freight-offers/search` |
| `freight.offer.event` | webhook-shaped publish event |
| `vehicle.space.publish` | `POST /freight-exchange/3/my-vehicle-space-offers` |
| `freight.quote.create` | `POST /freight-exchange/3/freight-quotes` |
