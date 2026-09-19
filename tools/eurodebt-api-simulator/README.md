# Eurodebt API simulator

> Application capture requires development mode, explicit enablement, configured tenant/organization and X-Trans-Inbox-Token. Set TRANS_INBOX_TOKEN in the simulator terminal. See [diagnostic inbox setup](../../apps/mercato/src/modules/trans_inbox/README.md). Provider authorization headers below are simulated and do not authenticate the diagnostic inbox.

Fire mock **company/carrier verification** traffic (and outbound webhook payloads)
shaped like [Eurodebt API](https://eurodebt.eu/api/docs/) into Open Mercato `trans_inbox`.

Docs live in `eurodebt_api_doc/openapi.json` (extracted from the public ReDoc page).

## Quick start

```bash
# list OpenAPI ops (+ synthetic webhook ops)
yarn eurodebt:sim catalog

# dry-run
yarn eurodebt:sim run tools/eurodebt-api-simulator/scenarios/smoke.yaml --dry-run

# hit local OM inbox (:3000)
TARGET_BASE_URL=http://127.0.0.1:3000 \
  yarn eurodebt:sim run tools/eurodebt-api-simulator/scenarios/smoke.yaml

# every 3s
yarn eurodebt:sim run tools/eurodebt-api-simulator/scenarios/every-3s.yaml

# local mock of Eurodebt API
yarn eurodebt:sim mock-server --port 4200
TARGET_BASE_URL=http://127.0.0.1:4200 \
  yarn eurodebt:sim run tools/eurodebt-api-simulator/scenarios/against-mock-eurodebt.yaml
```

## Templates

| Template | Default op | Notes |
|----------|------------|-------|
| `verification.submit` | `POST /api/v1.0/verification/submit` | inbound API-shaped body |
| `verification.completed` | `POST /webhooks/verificationCompleted` | signed webhook payload |
| `verification.rejected` | same | `status: rejected` |

Webhook scenarios set `X-Eurodebt-Signature: sha256=…` via `EURODEBT_WEBHOOK_SECRET` (default `eurodebt-sim-secret`).

## Inbox sink

```
POST /api/integrations/eurodebt/webhooks/{channel}
```

Typical channels: `verification`, `verification-submit`.
