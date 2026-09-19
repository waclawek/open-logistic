# Exchange simulator playbook

The tools generate **synthetic diagnostic traffic**, not production integrations or business records.

| Source | Local API snapshot | Simulator |
| --- | --- | --- |
| Trans.eu | `trans_api_doc/` | `tools/trans-api-simulator/` |
| TIMOCOM | `timocom_api_doc/` | `tools/timocom-api-simulator/` |
| Eurodebt | `eurodebt_api_doc/` | `tools/eurodebt-api-simulator/` |

## Application capture

Follow [the development inbox setup](../../apps/mercato/src/modules/trans_inbox/README.md). The server requires development mode, an explicit enable flag, a random shared token and configured tenant/organization UUIDs. Supply the same token to the simulator terminal as `TRANS_INBOX_TOKEN`, and set `TARGET_BASE_URL` to the running application.

`POST /api/integrations/{trans|timocom|eurodebt}/webhooks/{channel}` accepts JSON with the `X-Trans-Inbox-Token` header. The server fixes scope from configuration; simulator headers cannot choose an organization.

Open `/backend/trans_inbox` as an authorized administrator in that organization. This view is separate from logistics offers/transports. It displays sanitized data in process-local memory, up to 100 entries per scope and one-hour retention. There is no clear endpoint. Production capture is disabled. SSE carries a request ID only and the UI reloads the authenticated feed.

```powershell
$env:TARGET_BASE_URL = 'http://127.0.0.1:3000'
$env:TRANS_INBOX_TOKEN = '<same random token configured on the server>'
yarn sim:all:3s
```

## Offline checks

No application or credentials are needed for dry runs:

```sh
yarn sim:all:3s --smoke --dry-run
yarn trans:sim catalog
yarn timocom:sim catalog
yarn eurodebt:sim catalog
```

Provider mock servers are local synthetic response servers for developing adapters offline. They do not implement full provider authorization, schema validation or durable CRUD semantics. See each simulator README for mock-server and scenario commands.

Scenarios support batches, configurable parallelism/RPS/timeouts, periodic schedules and NDJSON reports. Reports are overwritten on every run. Do not send production credentials or personal data.

## Routing demo

[GraphHopper demo](../../tools/graphhopper-demo/README.md) is a standalone fixture/live routing demonstration. It uses a car profile, not truck constraints; it is not connected to business routing. Bash, Docker and a large OSM import are required for live Poland routing. The fixture works without GraphHopper, but the viewer still downloads Leaflet and OSM tiles.
