#!/usr/bin/env node
/**
 * Wysyła demonstracyjne zapytania transportowe na webhook inbox_ops.
 *
 * Podpisuje każdy POST tak samo jak `offers-send-email`:
 * HMAC SHA256 z `"<timestamp>.<rawBody>"`, sekret z INBOX_OPS_WEBHOOK_SECRET,
 * nagłówki `x-webhook-timestamp` i `x-webhook-signature`. Serwer odrzuca
 * timestamp starszy niż 5 minut.
 *
 * Dedup po stronie core liczy hash z `subject|from|pierwsze 500 znaków treści`,
 * bez okna czasowego. Dlatego domyślnie do tematu i treści dopisywany jest
 * numer referencyjny, inny przy każdej wysyłce. Wyłącza to `--no-unique`,
 * wtedy drugi przebieg dostanie 200 i nic nie zapisze.
 *
 *   node tools/inbox-demo/send.mjs --interval 2
 *   node tools/inbox-demo/send.mjs --once --limit 3
 *   node tools/inbox-demo/send.mjs --dry-run
 */

import { createHmac, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEBHOOK_PATH = '/api/inbox_ops/webhook/inbound'

const USAGE = `Wysyłka demonstracyjnych maili na webhook inbox_ops.

  node tools/inbox-demo/send.mjs [opcje]

Opcje:
  --base <url>       Adres aplikacji. Domyślnie http://localhost:3000
                     (albo zmienna BASE / OM_BASE_URL).
  --interval <min>   Odstęp między mailami w minutach. Domyślnie 2.
  --once             Wyślij jeden mail i zakończ.
  --limit <n>        Wyślij tylko n pierwszych maili z listy.
  --start <n>        Zacznij od pozycji n (liczone od 1).
  --only <klucze>    Lista kluczy po przecinku, np. gdansk-katowice-ftl.
  --loop             Po ostatnim mailu zacznij listę od nowa.
  --shuffle          Losowa kolejność.
  --no-unique        Nie dopisuj numeru referencyjnego (włącza dedup).
  --dry-run          Pokaż, co poleci, bez wysyłki i bez podpisu.
  --file <path>      Inny plik z mailami. Domyślnie ./emails-pl.json
  --help             Ta pomoc.

Sekret: INBOX_OPS_WEBHOOK_SECRET z .env aplikacji (nie jest nigdzie drukowany).`

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i]
    if (!part.startsWith('--')) continue
    const key = part.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      args[key] = next
      i += 1
    } else {
      args[key] = true
    }
  }
  return args
}

function fail(...lines) {
  for (const line of lines) console.error(line)
  process.exit(1)
}

function readNumber(value, label, min) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min) {
    fail(`${label} musi być liczbą nie mniejszą niż ${min}.`)
  }
  return parsed
}

function referenceToken(now) {
  const stamp = now.toISOString().slice(5, 16).replace(/[-:T]/g, '')
  return `ZAP-${stamp}-${randomBytes(2).toString('hex').toUpperCase()}`
}

/**
 * Wstawia numer referencyjny do tematu i na początek treści.
 *
 * Do treści trafia od razu po pierwszej linii, bo hash bierze tylko pierwsze
 * 500 znaków. Dopisek na końcu długiego maila nie zmieniłby hasha.
 */
function makeUnique(payload, reference) {
  const text = payload.text ?? ''
  const lines = text.split('\n')
  const head = lines[0] ?? ''
  const rest = lines.slice(1).join('\n')
  return {
    ...payload,
    subject: `${payload.subject ?? ''} [${reference}]`.trim(),
    text: `${head}\n\nNr referencyjny zapytania: ${reference}\n${rest}`,
    messageId: payload.messageId
      ? payload.messageId.replace(/^<(.*)>$/, `<${reference.toLowerCase()}.$1>`)
      : undefined,
  }
}

function sign(rawBody, secret, now) {
  const timestamp = String(Math.floor(now.getTime() / 1000))
  return {
    timestamp,
    signature: createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex'),
  }
}

async function postOne({ url, payload, secret, dryRun }) {
  const rawBody = JSON.stringify(payload)
  if (dryRun) return { status: 0, body: '(dry-run)' }
  const { timestamp, signature } = sign(rawBody, secret, new Date())
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-webhook-timestamp': timestamp,
      'x-webhook-signature': signature,
    },
    body: rawBody,
  })
  return { status: response.status, body: (await response.text()).slice(0, 200) }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || args.h) {
    console.log(USAGE)
    return
  }

  const dryRun = Boolean(args['dry-run'])
  const unique = !args['no-unique']
  const base = String(args.base || process.env.BASE || process.env.OM_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
  const url = `${base}${WEBHOOK_PATH}`
  const intervalMinutes = args.interval ? readNumber(args.interval, '--interval', 0) : 2
  const intervalMs = Math.round(intervalMinutes * 60 * 1000)

  const secret = process.env.INBOX_OPS_WEBHOOK_SECRET?.trim()
  if (!secret && !dryRun) {
    fail(
      'INBOX_OPS_WEBHOOK_SECRET nie jest ustawiony, więc nie ma czym podpisać żądania.',
      'Serwer odpowiedziałby 503. Ta sama wartość musi być w apps/mercato/.env:',
      '  INBOX_OPS_WEBHOOK_SECRET=<długi losowy ciąg>',
      '',
      'Podgląd bez wysyłki: node tools/inbox-demo/send.mjs --dry-run',
    )
  }

  const filePath = resolve(HERE, String(args.file || 'emails-pl.json'))
  const file = JSON.parse(await readFile(filePath, 'utf8'))
  let queue = [...file.emails]

  if (args.only) {
    const wanted = String(args.only).split(',').map((k) => k.trim()).filter(Boolean)
    queue = queue.filter((item) => wanted.includes(item.key))
    const missing = wanted.filter((k) => !file.emails.some((item) => item.key === k))
    if (missing.length) fail(`Nieznane klucze: ${missing.join(', ')}`)
  }
  if (args.start) queue = queue.slice(readNumber(args.start, '--start', 1) - 1)
  if (args.shuffle) queue.sort(() => Math.random() - 0.5)
  if (args.limit) queue = queue.slice(0, readNumber(args.limit, '--limit', 1))
  if (args.once) queue = queue.slice(0, 1)
  if (!queue.length) fail('Nie ma nic do wysłania.')

  const loop = Boolean(args.loop) && !args.once
  console.log(`cel:      ${url}`)
  console.log(`maile:    ${queue.length} z ${file.emails.length} (${filePath.replace(process.cwd() + '/', '')})`)
  console.log(`odstęp:   ${intervalMinutes} min${loop ? ', w pętli' : ''}`)
  console.log(`unikalne: ${unique ? 'tak, numer referencyjny w temacie' : 'nie, dedup odrzuci powtórki'}`)
  console.log(dryRun ? 'tryb:     dry-run, nic nie wychodzi\n' : '')

  let sent = 0
  let index = 0
  while (index < queue.length) {
    const item = queue[index]
    const reference = referenceToken(new Date())
    const payload = unique ? makeUnique(item.payload, reference) : item.payload

    try {
      const result = await postOne({ url, payload, secret, dryRun })
      sent += 1
      console.log(
        `[${new Date().toLocaleTimeString('pl-PL')}] ${String(index + 1).padStart(2, '0')}/${queue.length} ` +
        `${item.key.padEnd(38)} ${result.status} ${result.body}`,
      )
      if (dryRun) console.log(`    temat: ${payload.subject}`)
    } catch (error) {
      console.error(
        `[${new Date().toLocaleTimeString('pl-PL')}] ${item.key} BŁĄD: ${error.message}`,
      )
      console.error('    Serwer nie odpowiada. Uruchom aplikację albo popraw --base.')
    }

    index += 1
    if (index >= queue.length && loop) index = 0
    if (index < queue.length && intervalMs > 0) {
      console.log(`    następny za ${intervalMinutes} min`)
      await sleep(intervalMs)
    }
  }

  console.log(`\nWysłano: ${sent}`)
}

process.on('SIGINT', () => {
  console.log('\nPrzerwano.')
  process.exit(0)
})

main().catch((error) => fail(error.stack || error.message))
