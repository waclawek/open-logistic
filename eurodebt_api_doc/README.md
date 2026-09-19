# Eurodebt API docs

Company / carrier verification API ([eurodebt.eu/api/docs](https://eurodebt.eu/api/docs/)).

- Base URL: `https://api.eurodebt.eu/api/{version}` (current: `v1.0`)
- Auth: `x-api-key` header
- Webhooks: HMAC-SHA256 via `X-Eurodebt-Signature: sha256=<hex>`

Local OpenAPI extracted from the public ReDoc bundle:

- `openapi.json` — OpenAPI 3.1.0

Simulator: `tools/eurodebt-api-simulator/`
