import { randomUUID } from 'node:crypto'
import { resolveInboxConfig, authenticateInboxRequest } from '../lib/config'
import { listInboxRequests, pushInboxRequest, redactSecrets, sanitizeHeaders, MAX_ITEMS, MAX_SCOPES } from '../lib/inbox-store'
import { readWebhookBody, MAX_BODY_BYTES } from '../lib/request-body'

const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
const token = 'diagnostic-test-token-at-least-32-characters'
const env = { NODE_ENV: 'development', TRANS_INBOX_ENABLED: 'true', TRANS_INBOX_TOKEN: token, TRANS_INBOX_TENANT_ID: scope.tenantId, TRANS_INBOX_ORGANIZATION_ID: scope.organizationId }
const input = { ...scope, source: 'trans', channel: 'freight', method: 'POST', path: '/test', status: 202, headers: {}, query: {}, body: { value: 1 }, bytes: 11, contentType: 'application/json' }

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).__openMercatoScopedTransInboxStore__
})

describe('development inbox configuration', () => {
  it('requires development mode, opt-in, complete trusted scope and strong token', () => {
    expect(resolveInboxConfig(env)).toEqual({ ...scope, token })
    for (const disabled of [
      { NODE_ENV: 'production' }, { TRANS_INBOX_ENABLED: 'false' },
      { TRANS_INBOX_TOKEN: '' }, { TRANS_INBOX_TOKEN: 'short' },
      { TRANS_INBOX_ORGANIZATION_ID: '' }, { TRANS_INBOX_TENANT_ID: 'invalid' },
    ]) expect(resolveInboxConfig({ ...env, ...disabled })).toBeNull()
  })

  it('accepts only the independent shared secret', () => {
    const config = { ...scope, token }
    expect(authenticateInboxRequest(new Headers({ 'X-Trans-Inbox-Token': token }), config)).toBe(true)
    expect(authenticateInboxRequest(new Headers({ Authorization: 'Bearer ' + token }), config)).toBe(false)
    expect(authenticateInboxRequest(new Headers({ 'X-Trans-Inbox-Token': 'wrong' }), config)).toBe(false)
    expect(authenticateInboxRequest(new Headers(), config)).toBe(false)
  })
})

describe('bounded scoped storage', () => {
  it('isolates tenants and organizations', () => {
    const captured = pushInboxRequest(input)
    expect(listInboxRequests(scope)).toEqual([captured])
    expect(listInboxRequests({ ...scope, tenantId: randomUUID() })).toEqual([])
    expect(listInboxRequests({ ...scope, organizationId: randomUUID() })).toEqual([])
  })

  it('retains only the newest 100 entries and bounds the number of scopes', () => {
    for (let index = 0; index <= MAX_ITEMS; index++) pushInboxRequest({ ...input, body: { index } })
    const items = listInboxRequests(scope)
    expect(items).toHaveLength(MAX_ITEMS)
    expect(items[0].body).toEqual({ index: MAX_ITEMS })
    for (let index = 0; index < MAX_SCOPES; index++) pushInboxRequest({ ...input, organizationId: randomUUID() })
    expect(listInboxRequests(scope)).toEqual([])
  })

  it('expires old diagnostic data', () => {
    jest.useFakeTimers()
    pushInboxRequest(input)
    jest.advanceTimersByTime(60 * 60 * 1000 + 1)
    expect(listInboxRequests(scope)).toEqual([])
    jest.useRealTimers()
  })

  it('redacts credentials recursively before storage', () => {
    const captured = pushInboxRequest({
      ...input,
      body: { password: 'hidden', nested: [{ api_key: 'hidden', authorization: 'hidden' }], note: token, safe: 12 },
      query: { access_token: 'hidden', safe: 'visible' },
      headers: sanitizeHeaders(new Headers({ Authorization: 'Bearer hidden', 'X-Api-Key': 'hidden', 'X-Trans-Inbox-Token': token, 'Content-Type': 'application/json' })),
    }, token)
    expect(JSON.stringify(captured)).not.toContain('hidden')
    expect(JSON.stringify(captured)).not.toContain(token)
    expect(captured.headers).toEqual({ 'content-type': 'application/json' })
    expect(captured.query).toEqual({ access_token: '[redacted]', safe: 'visible' })
    expect(redactSecrets({ secret: 'x', safe: true })).toEqual({ secret: '[redacted]', safe: true })
  })
})

describe('request bounds', () => {
  it('accepts TIMOCOM vendor JSON', async () => {
    const req = new Request('http://localhost/test', { method: 'POST', headers: { 'Content-Type': 'application/vnd.freight-exchange.v3+json; charset=utf-8' }, body: '{"hello":"world"}' })
    await expect(readWebhookBody(req)).resolves.toMatchObject({ body: { hello: 'world' }, bytes: 17 })
  })

  it('rejects unsupported content, malformed JSON and array bodies', async () => {
    const request = (body: string, contentType = 'application/json') => new Request('http://localhost/test', { method: 'POST', body, headers: { 'Content-Type': contentType } })
    await expect(readWebhookBody(request('{}', 'text/plain'))).rejects.toMatchObject({ status: 415 })
    await expect(readWebhookBody(request('{bad'))).rejects.toMatchObject({ status: 400 })
    await expect(readWebhookBody(request('[]'))).rejects.toMatchObject({ status: 400 })
  })

  it('rejects large bodies even without Content-Length', async () => {
    const req = new Request('http://localhost/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: 'x'.repeat(MAX_BODY_BYTES) }) })
    await expect(readWebhookBody(req)).rejects.toMatchObject({ status: 413 })
  })
})
