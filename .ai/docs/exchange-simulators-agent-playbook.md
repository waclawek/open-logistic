# Exchange / verification API simulators → Open Mercato agent

Short playbook for the three hackathon sources and how to wire them into an OM AI agent later.

| Source | Docs | Simulator | What it is |
|--------|------|-----------|------------|
| **Trans.eu** | `trans_api_doc/` | `tools/trans-api-simulator` | Freight exchange (freights, orders, partners, vehicles…) |
| **TIMOCOM** | `timocom_api_doc/` | `tools/timocom-api-simulator` | Freight Exchange v3 (offers, vehicle spaces, quotes) |
| **Eurodebt** | `eurodebt_api_doc/` ([public ReDoc](https://eurodebt.eu/api/docs/)) | `tools/eurodebt-api-simulator` | Company/carrier VAT verification + signed webhooks |

All three today **only generate mock traffic** into the app inbox. They do **not** call production APIs. Eurodebt does **not** look up a real NIP — it invents VAT/company unless you override `vars`.

Live sink UI: `/backend/trans_inbox` (module `apps/mercato/src/modules/trans_inbox`).

---

## 1. Run (dev)

```bash
yarn dev                                          # usually :3001
export TARGET_BASE_URL=http://127.0.0.1:3001
export TRANS_INBOX_TENANT_ID=<tenant-uuid>        # optional → SSE

yarn trans:sim    run tools/trans-api-simulator/scenarios/smoke.yaml
yarn timocom:sim  run tools/timocom-api-simulator/scenarios/smoke.yaml
yarn eurodebt:sim run tools/eurodebt-api-simulator/scenarios/smoke.yaml

yarn sim:all:3s                                   # all three, every 3s
```

Catalog / templates:

```bash
yarn <trans|timocom|eurodebt>:sim catalog
yarn <trans|timocom|eurodebt>:sim templates
```

Local mock of the *provider* API (not OM):

```bash
yarn timocom:sim  mock-server --port 4100
yarn eurodebt:sim mock-server --port 4200
```

---

## 2. Inbox contract (stable for agents)

Public webhook sink (no auth, rate-limited):

```
POST /api/integrations/{provider}/webhooks/{channel}
provider ∈ trans | timocom | eurodebt
```

Examples:

| Provider | Typical channel | Body shape |
|----------|-----------------|------------|
| `trans` | `freight`, `order` | Trans freight/order-ish JSON (simulator templates) |
| `timocom` | `freight-offer`, `vehicle-space` | TIMOCOM v3 offer / `timocom.freightOffer.published` event |
| `eurodebt` | `verification`, `verification-submit` | Submit request **or** `WebhookPayload` (`status`, `vatNumber`, `verificationId`, …) |

Response: `202` + `{ ok, id, provider, channel, receivedAt, broadcast }`.

Auth headers the simulators send (for later real adapters):

| Provider | Auth |
|----------|------|
| Trans | Basic / Bearer (scenario headers) |
| TIMOCOM | `Authorization: Basic …` + `Content-Type: application/vnd.freight-exchange.v3+json` |
| Eurodebt | `x-api-key` on API calls; outbound webhooks: `X-Eurodebt-Signature: sha256=<hmac>` (`EURODEBT_WEBHOOK_SECRET`) |

Feed for the agent / UI:

```
GET    /api/trans_inbox/feed?limit=150   # feature: trans_inbox.view
DELETE /api/trans_inbox/feed             # feature: trans_inbox.manage
```

SSE (optional): event `trans_inbox.request.received` when `TRANS_INBOX_TENANT_ID` / `X-Om-Tenant-Id` is set.

---

## 3. Plug into an OM AI agent (next step)

Do **not** call `tools/*/src` from the agent. Treat simulators as **traffic generators**; the agent talks to **module tools + real/mock HTTP clients**.

Recommended layout (mirror `customers` / `catalog`):

```
apps/mercato/src/modules/trans_inbox/   # or a dedicated logistics_integrations module
├── ai-agents.ts                        # e.g. logistics.exchange_assistant
├── ai-tools.ts                         # tool pack registry
├── ai-tools/
│   ├── inbox-pack.ts                   # read feed, filter by provider/channel
│   ├── trans-pack.ts                   # search/publish freight (HTTP client)
│   ├── timocom-pack.ts
│   └── eurodebt-pack.ts                # submit verification, poll report
├── acl.ts                              # trans_inbox.* + new tool features
└── lib/
    ├── clients/trans.ts
    ├── clients/timocom.ts
    └── clients/eurodebt.ts             # base URL + auth from env / secrets
```

### Tool ideas (Zod in → serializable out)

| Tool id (suggested) | Mode | Backed by |
|---------------------|------|-----------|
| `exchange.inbox_list` | read | `GET /api/trans_inbox/feed` |
| `exchange.inbox_get` | read | feed item by `id` |
| `trans.search_freights` | read | Trans client → freights API |
| `trans.publish_freight` | **mutation** | Trans client → `prepareMutation` |
| `timocom.search_offers` | read | TIMOCOM search |
| `timocom.publish_offer` | **mutation** | TIMOCOM `my-freight-offers` |
| `eurodebt.verify_company` | **mutation** | `POST …/verification/submit` |
| `eurodebt.get_report` | read | `GET …/verification/report/{id}` |

Rules from OM agent framework:

1. Register with `defineAiTool` + `requiredFeatures` in module `acl.ts` / `setup.ts`.
2. Every write → `prepareMutation(...)` (`confirm-required` agent). Never write inside the tool handler directly.
3. Point HTTP clients at:
   - **dev**: simulator mock-server (`:4100` / `:4200`) or passthrough scenarios
   - **prod**: real bases (`api.eurodebt.eu`, Trans/TIMOCOM hosts) + secrets
4. For Eurodebt **inbound** webhooks in prod: verify `X-Eurodebt-Signature` with the tenant webhook secret before `pushInboxRequest` / domain persist.
5. Keep OpenAPI copies under `*_api_doc/` as the contract source when generating Zod / client types.

### Minimal agent sketch

```ts
// ai-agents.ts (sketch — not shipped yet)
defineAiAgent({
  id: 'logistics.exchange_assistant',
  executionMode: 'chat',
  mutationPolicy: 'confirm-required',
  requiredFeatures: ['trans_inbox.view'],
  allowedTools: [
    'exchange.inbox_list',
    'eurodebt.verify_company',
    'eurodebt.get_report',
    // + trans/timocom tools when clients exist
  ],
})
```

Skill to follow when implementing: `.claude/skills/om-create-ai-agent/SKILL.md`  
Reference packs: `packages/core/src/modules/customers/ai-tools.ts`, `catalog/ai-tools.ts`.

---

## 4. Env cheat-sheet

```bash
TARGET_BASE_URL=http://127.0.0.1:3001
TRANS_INBOX_TENANT_ID=
TRANS_INBOX_ORGANIZATION_ID=

# TIMOCOM sim
TIMOCOM_SIM_BASIC=dGVzdDp0ZXN0          # base64 user:pass or raw user:pass

# Eurodebt sim
EURODEBT_SIM_API_KEY=eurodebt-sim-key
EURODEBT_WEBHOOK_SECRET=eurodebt-sim-secret

# Later (real adapters — not used by sims today)
# TRANS_API_BASE_URL=…
# TRANS_API_TOKEN=…
# TIMOCOM_API_BASE_URL=…
# TIMOCOM_BASIC=…
# EURODEBT_API_BASE_URL=https://api.eurodebt.eu/api/v1.0
# EURODEBT_API_KEY=…
```

---

## 5. File map

```
trans_api_doc/                 Trans OpenAPI YAMLs
timocom_api_doc/               TIMOCOM Freight Exchange OpenAPI
eurodebt_api_doc/openapi.json  Eurodebt OpenAPI 3.1 (from ReDoc)

tools/trans-api-simulator/
tools/timocom-api-simulator/
tools/eurodebt-api-simulator/
tools/run-both-sims-3s.mjs     Trans + TIMOCOM
tools/run-all-sims-3s.mjs      + Eurodebt

apps/mercato/src/modules/trans_inbox/
```

Per-simulator details: each tool’s own `README.md`.
