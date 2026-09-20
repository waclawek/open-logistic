#!/usr/bin/env node
// The Airside landing page and its contact form.
//
//   node landing/serve.mjs            -> http://127.0.0.1:8787
//   PORT=9000 node landing/serve.mjs  -> http://127.0.0.1:9000
//
// Serves the page from this directory and forwards each accepted form post to
// the running app's inbound email webhook, signed. From there the existing
// offer-automation flow takes over: core stores the email, emits
// `inbox_ops.email.received`, the logistics extraction subscriber turns it into
// a proposal, and a human accepts the action that creates the quote.
//
// Node standard library only. No dependencies, no build step.

import http from 'node:http'
import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '127.0.0.1'
const APP_URL = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
// The recipient address is what picks the tenant inside core's webhook: core
// resolves it to one `inbox_settings` row and takes the tenant and organization
// off that row, ignoring everything else in the payload. `offers-prepare`
// writes this address.
const INBOX_ADDRESS = process.env.LANDING_INBOX_ADDRESS ?? 'quotes@logistics.example'

// ---------------------------------------------------------------------------
// Signing.
//
// SOURCE OF TRUTH:
//   apps/mercato/src/modules/logistics/lib/offer-automation/inboxWebhook.ts
// That file is what `offers-send-email` signs with and what core verifies
// against. The recipe is inlined here only because a plain node script cannot
// import the module's TypeScript without a build. If core's scheme ever moves,
// it moves there first — check these four lines against that file.
//
//   signature = hmac_sha256(secret, `${timestampSeconds}.${rawBody}`), hex
//   headers   = x-webhook-timestamp, x-webhook-signature
//   path      = /api/inbox_ops/webhook/inbound
//
// The secret is read from the environment and never printed, never logged and
// never sent to the browser. That is the whole reason the form posts here
// instead of straight at the app.
// ---------------------------------------------------------------------------
const WEBHOOK_SECRET_ENV = 'INBOX_OPS_WEBHOOK_SECRET'
const INBOUND_WEBHOOK_PATH = '/api/inbox_ops/webhook/inbound'

function signWebhookRequest(payload, secret, now = new Date()) {
  // Serialised once and both signed and sent: the signature covers the raw
  // bytes, so re-serialising before the POST would be a different string.
  const body = JSON.stringify(payload)
  const timestamp = String(Math.floor(now.getTime() / 1000))
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'x-webhook-timestamp': timestamp,
      'x-webhook-signature': signature,
    },
  }
}

// --------------------------------------------------------------- static files

// The allowlist is the security boundary. A request path is looked up here, it
// is never joined onto a directory, so `..`, an encoded separator and an
// absolute path are all simply misses.
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/logo-airside.webp', ['logo-airside.webp', 'image/webp']],
  ['/fonts/archivo-latin.woff2', ['fonts/archivo-latin.woff2', 'font/woff2']],
  ['/fonts/archivo-latin-ext.woff2', ['fonts/archivo-latin-ext.woff2', 'font/woff2']],
])

const CONTACT_PATH = '/contact'
const MAX_BODY_BYTES = 64 * 1024

// Same cap `offers-send-email` puts on `--body`, for the same reason: the body
// is pasted whole into the extraction prompt, so a runaway paste is spent as
// model context. See customEmailInput.ts, MAX_BODY_CHARS.
const MAX_MESSAGE_CHARS = 16000
const MAX_EMAIL_CHARS = 254
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

// The form has no subject field, so this is fixed. Core deduplicates on subject
// plus sender plus body together, so a constant subject still lets two
// different enquiries through.
const ENQUIRY_SUBJECT = 'Ad-hoc freight request from the website'

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// The page validates these two rules in the browser too. That check is the
// visitor's own JavaScript and anything can POST here, so these are the ones
// that count. `field` matches an input id on the page, which puts the message
// under the right box.
function validate(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { field: 'message', error: 'Tell us what needs moving.' }
  }
  const message = typeof data.message === 'string' ? data.message.trim() : ''
  const email = typeof data.email === 'string' ? data.email.trim() : ''

  if (!message) return { field: 'message', error: 'Tell us what needs moving.' }
  if (message.length > MAX_MESSAGE_CHARS) {
    return { field: 'message', error: `Keep the shipment note under ${MAX_MESSAGE_CHARS} characters.` }
  }
  if (!email) return { field: 'email', error: 'Add an email address so we can reply.' }
  if (email.length > MAX_EMAIL_CHARS || !EMAIL_RE.test(email)) {
    return { field: 'email', error: 'That email address does not look right.' }
  }
  return { value: { message, email: email.toLowerCase() } }
}

/** Delivers one enquiry as a signed inbound email. Returns what to tell whom. */
async function deliver({ message, email }, secret) {
  const messageId = `<openlogistic-landing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@localhost>`
  const payload = {
    from: email,
    to: INBOX_ADDRESS,
    subject: ENQUIRY_SUBJECT,
    text: message,
    messageId,
    replyTo: email,
  }
  const url = `${APP_URL}${INBOUND_WEBHOOK_PATH}`
  const signed = signWebhookRequest(payload, secret)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  let response
  let responseBody = ''
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: signed.headers,
      body: signed.body,
      signal: controller.signal,
    })
    responseBody = await response.text()
  } catch (err) {
    return { ok: false, url, messageId, detail: `unreachable: ${err.message}` }
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    return {
      ok: false,
      url,
      messageId,
      status: response.status,
      detail: `HTTP ${response.status}: ${responseBody || '<empty>'}`,
    }
  }
  return { ok: true, url, messageId, status: response.status, responseBody }
}

// ---------------------------------------------------------------- the server

const secret = (process.env[WEBHOOK_SECRET_ENV] ?? '').trim()
if (!secret) {
  console.error(`\n${WEBHOOK_SECRET_ENV} is not set, so this server cannot sign the webhook.`)
  console.error('Add one line to apps/mercato/.env and export it here too. Any long random')
  console.error('string will do, and the value is never printed:')
  console.error(`  ${WEBHOOK_SECRET_ENV}=<a long random string>`)
  console.error('The APP reads the same variable, so both sides must hold the same value.\n')
  process.exit(1)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`)

  if (url.pathname === CONTACT_PATH) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'Use POST for /contact.' })
      return
    }

    let raw
    try {
      raw = await readBody(req)
    } catch {
      sendJson(res, 413, { ok: false, error: 'That request is too large to accept.' })
      return
    }

    let parsed
    try {
      parsed = JSON.parse(raw || 'null')
    } catch {
      sendJson(res, 400, { ok: false, field: 'message', error: 'Tell us what needs moving.' })
      return
    }

    const checked = validate(parsed)
    if (checked.error) {
      sendJson(res, 400, { ok: false, field: checked.field, error: checked.error })
      return
    }

    const result = await deliver(checked.value, secret)

    if (!result.ok) {
      // Full detail to the operator, who can fix it. The visitor gets a short
      // honest failure naming nothing internal, and the page keeps every word
      // they typed.
      console.error(`\n[${new Date().toISOString()}] DELIVERY FAILED`)
      console.error(`  from:      ${checked.value.email}`)
      console.error(`  to:        ${INBOX_ADDRESS}`)
      console.error(`  webhook:   POST ${result.url}`)
      console.error(`  messageId: ${result.messageId}`)
      console.error(`  cause:     ${result.detail}`)
      if (String(result.status) === '503') {
        console.error(`  fix:       the APP has no ${WEBHOOK_SECRET_ENV}. Set it there and restart it.`)
      } else if (String(result.status) === '400') {
        console.error('  fix:       signature or timestamp rejected. Both sides need the same')
        console.error(`             ${WEBHOOK_SECRET_ENV} and clocks within five minutes.`)
      } else if (result.detail.startsWith('unreachable')) {
        console.error(`  fix:       nothing is answering at ${APP_URL}. Start the app, or set APP_URL.`)
      }
      console.error('')
      sendJson(res, 502, {
        ok: false,
        error: 'We could not take that request just now. Nothing was sent, so please try again in a moment.',
      })
      return
    }

    // Core answers 200 {"ok":true} for a stored email, an unknown recipient and
    // a duplicate alike, so this line says what was delivered, not what was
    // stored. Read the proposals list to see which of the three happened.
    console.log(`\n[${new Date().toISOString()}] request delivered`)
    console.log(`  from:      ${checked.value.email}`)
    console.log(`  to:        ${INBOX_ADDRESS}`)
    console.log(`  webhook:   POST ${result.url} -> ${result.status} ${result.responseBody}`)
    console.log(`  messageId: ${result.messageId}`)
    console.log(`  read it:   ${APP_URL}/backend/inbox-ops`)
    console.log(`  ${checked.value.message.replace(/\n/g, '\n  ')}\n`)

    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { ok: false, error: `Use GET for ${url.pathname}.` })
    return
  }

  const asset = ASSETS.get(url.pathname)
  if (!asset) {
    sendJson(res, 404, { ok: false, error: `Nothing is published at ${url.pathname}.` })
    return
  }

  const [file, contentType] = asset
  let bytes
  try {
    bytes = await readFile(path.join(HERE, ...file.split('/')))
  } catch (err) {
    console.error(`could not read ${file}: ${err.message}`)
    sendJson(res, 500, { ok: false, error: 'That file could not be read.' })
    return
  }
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': bytes.length,
    'cache-control': 'no-store',
  })
  res.end(req.method === 'HEAD' ? undefined : bytes)
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already taken. Stop whatever holds it, or run with PORT=8788.\n`)
    process.exit(1)
  }
  throw err
})

// A malformed request still gets JSON back, never an HTML error page.
server.on('clientError', (_err, socket) => {
  const body = JSON.stringify({ ok: false, error: 'Malformed request.' })
  socket.end(
    `HTTP/1.1 400 Bad Request\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`,
  )
})

function shutDown() {
  console.log('\nStopping.')
  server.close(() => process.exit(0))
  // A held-open keep-alive connection must not outlive the Ctrl-C.
  setTimeout(() => process.exit(0), 2000).unref()
}
process.on('SIGINT', shutDown)
process.on('SIGTERM', shutDown)

server.listen(PORT, HOST, () => {
  console.log(`\nAirside landing page:  http://${HOST}:${PORT}`)
  console.log(`Form posts to:         ${CONTACT_PATH} (same origin)`)
  console.log(`Delivers to:           ${INBOX_ADDRESS} via ${APP_URL}${INBOUND_WEBHOOK_PATH}`)
  console.log(`Signed with:           ${WEBHOOK_SECRET_ENV} (set; value never printed)`)
  console.log('Ctrl-C to stop.\n')
})
