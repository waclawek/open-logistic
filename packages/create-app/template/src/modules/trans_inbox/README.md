# Development webhook diagnostics

Separate view: `/backend/trans_inbox`. This module captures synthetic Trans.eu, TIMOCOM and Eurodebt JSON traffic. It does not create offers, orders or carrier decisions and does not call providers.

## Enable locally

Run the application with `NODE_ENV=development` and configure in its environment:

- `TRANS_INBOX_ENABLED=true`
- `TRANS_INBOX_TOKEN`: a generated random shared token of at least 32 characters
- `TRANS_INBOX_TENANT_ID`: the destination tenant UUID
- `TRANS_INBOX_ORGANIZATION_ID`: the destination organization UUID

Set the same `TRANS_INBOX_TOKEN` in the simulator terminal and point `TARGET_BASE_URL` at the application. Example PowerShell:

```powershell
$env:TARGET_BASE_URL = 'http://127.0.0.1:3000'
$env:TRANS_INBOX_TOKEN = '<same generated token as the server>'
yarn sim:all:3s
```

Use only synthetic data. The token is sent in `X-Trans-Inbox-Token`; this is separate from simulated provider credentials. Ingestion is disabled in production or with incomplete configuration. Requests cannot choose their tenant/organization through headers, query parameters or body fields.

## Access and retention

The authenticated feed requires `trans_inbox.view`, granted to admin/superadmin during setup. Existing environments need the standard `yarn mercato auth sync-role-acls` sync. The feed follows the authenticated organization scope. Read responses are not cached.

The process-local store keeps up to 100 recent requests per scope, up to 8 scopes, for at most an hour. Restarting loses all entries; multiple server processes have independent stores. There is deliberately no clear API or clear action. This is diagnostic data, not durable business storage.

## API

- `POST /api/integrations/{trans|timocom|eurodebt}/webhooks/{channel}`: development token, trusted configured scope, rate limit, JSON/`+json` only, 64 KiB body limit, standard mutation guards.
- `GET /api/trans_inbox/feed?limit=100`: authenticated, feature gated, selected organization only.
- SSE carries only a scoped request ID; the UI reloads through the authenticated feed and also polls every three seconds.

Credential headers are omitted; secret-like JSON/query keys and the configured token are redacted before storage. Do not use this diagnostic endpoint for real credentials or production payloads.
