# Email to quote demo, from the CLI

One inbound customer email becomes an inbox proposal. A human accepts it, and code prices
the quote from the catalogue. Run every command below from `apps/mercato`.

## Before you start

1. [ ] The app is running on `http://localhost:3000` (`yarn dev` from the repo root).
2. [ ] A queue worker is draining, started from `apps/mercato`. `yarn dev` spawns one.
3. [ ] These environment variables are set in `apps/mercato/.env`. Names only, never paste a value
       into a slide or a terminal someone can see:
       - `INBOX_OPS_WEBHOOK_SECRET`, the HMAC key the send command signs with and the server verifies.
       - `APP_URL`, only if the app is not on `http://localhost:3000`.
       - `QUEUE_BASE_DIR`, only if you moved the queue off its default.
       - the provider API key variable, which `offers-check-ai` prints by name (`OPENAI_API_KEY`
         on the default OpenAI setup).

## Demo ids on this machine

```sh
export T=ad666ed4-cec8-44b5-9fde-88c573758bdd
export O=d27c3cae-8554-4b5a-b339-3bada5966ed1
```

On a fresh machine these do not exist. Run `yarn mercato init`, then read the tenant and
organization ids it prints and use those instead.

## The run

```sh
yarn mercato logistics offers-prepare --tenant $T --org $O
yarn mercato auth sync-role-acls --tenant $T
yarn mercato logistics offers-check-ai
yarn mercato logistics offers-send-email --tenant $T --org $O --note "Ref demo-1"
```

`offers-prepare` seeds the four services, the inbox address and the automation account, and is
idempotent. `sync-role-acls` grants the draft feature to the roles that accept these actions.
`offers-send-email` posts a signed email to the inbound webhook and then watches the rows, so
it prints a proposal URL like `http://localhost:3000/backend/inbox-ops/proposals/<id>`. Open it,
accept the action, and the draft quote appears under `/backend/sales/quotes`.

## What the catalogue sells

Say these out loud while the model is thinking.

| SKU | Price | Unit |
| --- | --- | --- |
| FRT-FTL-SHIPMENT | 1450.00 EUR | per shipment, dedicated 13.6 m curtainsider |
| FRT-LTL-PALLET | 68.00 EUR | per EUR pallet, groupage |
| FRT-ROAD-KM | 1.35 EUR | per kilometre, long distance |
| FRT-ACC-TAILLIFT | 45.00 EUR | per delivery stop, no dock |

## The refusal

```sh
yarn mercato logistics offers-send-email --tenant $T --org $O --note "Please quote in USD."
```

The model still extracts the enquiry and still proposes the action. Accepting it returns
HTTP 422 and writes no quote, because the catalogue has no USD price for those lines.

Show this one. It is the point of the whole design. The model is allowed to name SKUs and
quantities and nothing else, because its schema has no field for money anywhere. Every number
on the quote comes from the catalogue after a human accepts. A line that cannot be priced kills
the entire action rather than inventing a number, so the one outcome nobody recovers from, a
quote that left the building priced at nothing, cannot happen.

## Traps

1. [ ] Vary the body on every send. Core deduplicates on subject, sender and body with no time
       window and still answers HTTP 200, so a repeat looks like it worked and nothing happens.
       `--note "Ref <something new>"` is enough.
2. [ ] Start the queue worker from `apps/mercato`. `QUEUE_BASE_DIR` is relative, so a worker
       started at the repo root drains a different directory, reports itself healthy and the
       email waits forever.
3. [ ] Restart the worker after pulling this branch. A worker loads subscriber code once at
       startup and never reloads it, so an old process keeps running the old subscriber.
4. [ ] Question 2 of `offers-check-ai` is expected to fail on OpenAI and is harmless. It tests
       core's extraction schema, and this app disables core's extractor. Question 1 is the one
       that matters.

## Before you present

```sh
yarn mercato logistics offers-check-ai
```

Question 1 must say OK. If it does not, the key is missing, expired or out of quota, and the
extraction cannot run.
