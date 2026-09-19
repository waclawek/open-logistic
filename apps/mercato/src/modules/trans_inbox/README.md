# Trans Inbox (app module)

Dev sink for marketplace / verification simulators:

- [`tools/trans-api-simulator`](../../../../tools/trans-api-simulator) (Trans.eu)
- [`tools/timocom-api-simulator`](../../../../tools/timocom-api-simulator) ([TIMOCOM](https://developer.timocom.com/))
- [`tools/eurodebt-api-simulator`](../../../../tools/eurodebt-api-simulator) ([Eurodebt](https://eurodebt.eu/api/docs/))

Shows them live at `/backend/trans_inbox`.

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/api/integrations/{trans\|timocom\|eurodebt}/webhooks/{channel}` | public + rate limit |
| `GET` | `/api/trans_inbox/feed` | `trans_inbox.view` |
| `DELETE` | `/api/trans_inbox/feed` | `trans_inbox.manage` |

Channels e.g. `freight`, `order`, `freight-offer`, `vehicle-space`, `verification`.

## Quick test

```bash
# Eurodebt → inbox (app often on :3001)
TARGET_BASE_URL=http://127.0.0.1:3001 \
TRANS_INBOX_TENANT_ID=<tenant> \
  yarn eurodebt:sim run tools/eurodebt-api-simulator/scenarios/smoke.yaml

# TIMOCOM → inbox
TARGET_BASE_URL=http://127.0.0.1:3001 \
  yarn timocom:sim run tools/timocom-api-simulator/scenarios/smoke.yaml

# Trans.eu → inbox
TARGET_BASE_URL=http://127.0.0.1:3001 \
  yarn trans:sim run tools/trans-api-simulator/scenarios/smoke.yaml

# all three every 3s
yarn sim:all:3s
```
