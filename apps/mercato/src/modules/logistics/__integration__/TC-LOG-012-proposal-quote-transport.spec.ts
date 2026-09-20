import { randomUUID } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { expect, test } from './helpers/fixtures'

export const integrationMeta = { dependsOnModules: ['sales', 'customers', 'inbox_ops'] }

type InboxFixture = {
  actionId: string
  emailId: string
  proposalId: string
}

type SalesDocument = {
  id: string
  metadata?: Record<string, unknown> | null
  orderNumber?: string
  updatedAt?: string
  updated_at?: string
}

type TransportListResponse = {
  items?: Array<{
    id: string
    orderNumber: string
    pickupAddress: string | null
    deliveryAddress: string | null
    pickupWindowStart: string | null
    pickupWindowEnd: string | null
    cargoPallets: number | null
    cargoWeightKg: number | null
    clientPrice: number | null
  }>
  total?: number
}

const transportInput = {
  pickupAddress: 'Warszawa, Poland',
  deliveryAddress: 'Berlin, Germany',
  pickupWindowStart: '2026-10-01T08:00:00.000Z',
  pickupWindowEnd: '2026-10-01T12:00:00.000Z',
  deliveryWindowStart: '2026-10-02T08:00:00.000Z',
  cargoPallets: 4,
  cargoWeightKg: 2000,
  clientPrice: 1250,
} as const

const transportMetadata = {
  version: 1,
  kind: 'client_transport',
  transportRole: 'client',
  transportOrderNumber: 1,
  ...transportInput,
} as const

async function seedTransportQuoteProposal(
  tenantId: string,
  organizationId: string,
): Promise<InboxFixture> {
  const fixture = {
    actionId: randomUUID(),
    emailId: randomUUID(),
    proposalId: randomUUID(),
  }
  const now = new Date()
  const payload = {
    customerName: `QA Transport Customer ${fixture.proposalId}`,
    currencyCode: 'EUR',
    customerReference: `QA-TRANSPORT-${fixture.proposalId}`,
    lineItems: [{
      productName: 'Road freight service',
      quantity: '1',
      unitPrice: String(transportInput.clientPrice),
      kind: 'service',
    }],
    transport: transportInput,
  }

  try {
    await withClient(async (client) => {
      await client.query(
        `insert into inbox_emails
          (id, forwarded_by_address, to_address, subject, raw_text, received_at, status,
           is_active, organization_id, tenant_id, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, 'processed', true, $7, $8, $6, $6)`,
        [
          fixture.emailId,
          'qa-transport-customer@example.com',
          'qa-logistics@example.com',
          'QA transport quote request',
          'Please quote four pallets from Warszawa to Berlin.',
          now,
          organizationId,
          tenantId,
        ],
      )
      await client.query(
        `insert into inbox_proposals
          (id, inbox_email_id, summary, participants, confidence, category, status,
           possibly_incomplete, is_active, organization_id, tenant_id, created_at, updated_at)
         values ($1, $2, $3, '[]'::jsonb, 1, 'rfq', 'pending', false, true, $4, $5, $6, $6)`,
        [
          fixture.proposalId,
          fixture.emailId,
          'QA transport quote proposal',
          organizationId,
          tenantId,
          now,
        ],
      )
      await client.query(
        `insert into inbox_proposal_actions
          (id, proposal_id, sort_order, action_type, description, payload, status, confidence,
           required_feature, is_active, organization_id, tenant_id, created_at, updated_at)
         values ($1, $2, 0, 'create_quote', $3, $4::jsonb, 'pending', 1,
           'sales.quotes.manage', true, $5, $6, $7, $7)`,
        [
          fixture.actionId,
          fixture.proposalId,
          'Create a client transport quote',
          JSON.stringify(payload),
          organizationId,
          tenantId,
          now,
        ],
      )
    })
  } catch (error) {
    await cleanupInboxFixture(fixture)
    throw error
  }

  return fixture
}

async function cleanupInboxFixture(fixture: InboxFixture): Promise<void> {
  await withClient(async (client) => {
    await client.query('delete from inbox_proposal_actions where id = $1', [fixture.actionId])
    await client.query('delete from inbox_proposals where id = $1', [fixture.proposalId])
    await client.query('delete from inbox_emails where id = $1', [fixture.emailId])
  })
}

async function readSalesDocument(
  request: APIRequestContext,
  resource: 'orders' | 'quotes',
  id: string,
): Promise<SalesDocument | null> {
  const response = await request.get(`/api/sales/${resource}?id=${encodeURIComponent(id)}`)
  expect(response.ok(), await response.text()).toBe(true)
  const body = await readJsonSafe<{ items?: SalesDocument[] }>(response)
  return body?.items?.find((item) => item.id === id) ?? null
}

async function deleteQuoteIfExists(request: APIRequestContext, quoteId: string | null): Promise<void> {
  if (!quoteId) return
  const quote = await readSalesDocument(request, 'quotes', quoteId)
  if (!quote) return
  const updatedAt = quote.updatedAt ?? quote.updated_at
  expect(updatedAt, 'Quote cleanup requires its optimistic-lock version').toBeTruthy()
  const response = await request.delete(`/api/sales/quotes?id=${encodeURIComponent(quoteId)}`, {
    headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: updatedAt! },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

test('TC-LOG-012 proposal transport quote converts to an order visible in AI Transports', async ({ page, request, logistics }) => {
  await logistics.prepareSales()
  await logistics.grant([
    'logistics.view',
    'inbox_ops.proposals.view',
    'inbox_ops.proposals.manage',
    'sales.quotes.view',
    'sales.quotes.manage',
    'sales.orders.view',
    'sales.orders.manage',
  ])
  await logistics.authorizeApi()

  const administratorToken = await getAuthToken(request, 'superadmin')
  const { tenantId } = getTokenContext(administratorToken)
  const fixture = await seedTransportQuoteProposal(tenantId, logistics.organizationId)
  let quoteId: string | null = null
  let orderId: string | null = null

  try {
    const acceptResponse = await page.request.post(
      `/api/inbox_ops/proposals/${fixture.proposalId}/actions/${fixture.actionId}/accept`,
    )
    const acceptBody = await readJsonSafe<{
      action?: { status?: string; createdEntityId?: string; createdEntityType?: string }
      proposal?: { status?: string }
    }>(acceptResponse)
    expect(acceptResponse.ok(), JSON.stringify(acceptBody)).toBe(true)
    expect(acceptBody?.action).toMatchObject({ status: 'executed', createdEntityType: 'sales_quote' })
    expect(acceptBody?.proposal?.status).toBe('accepted')
    quoteId = acceptBody?.action?.createdEntityId ?? null
    expect(quoteId, 'Accepted proposal action should create a Sales quote').toBeTruthy()

    const quote = await readSalesDocument(page.request, 'quotes', quoteId!)
    expect(quote?.metadata).toMatchObject({ logistics: transportMetadata })
    const quoteUpdatedAt = quote?.updatedAt ?? quote?.updated_at
    expect(quoteUpdatedAt, 'Quote conversion requires its optimistic-lock version').toBeTruthy()

    const convertResponse = await page.request.post('/api/sales/quotes/convert', {
      data: { quoteId },
      headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: quoteUpdatedAt! },
    })
    const convertBody = await readJsonSafe<{ orderId?: string }>(convertResponse)
    expect(convertResponse.ok(), JSON.stringify(convertBody)).toBe(true)
    orderId = convertBody?.orderId ?? null
    expect(orderId, 'Quote conversion should return a Sales order ID').toBeTruthy()
    quoteId = null

    const order = await readSalesDocument(page.request, 'orders', orderId!)
    expect(order?.metadata).toMatchObject({ logistics: transportMetadata })

    const transportsResponse = await page.request.get('/api/logistics/transports?pageSize=100')
    const transports = await readJsonSafe<TransportListResponse>(transportsResponse)
    expect(transportsResponse.ok(), JSON.stringify(transports)).toBe(true)
    expect(transports?.items?.find((item) => item.id === orderId)).toEqual(expect.objectContaining({
      id: orderId,
      orderNumber: order?.orderNumber,
      pickupAddress: transportMetadata.pickupAddress,
      deliveryAddress: transportMetadata.deliveryAddress,
      pickupWindowStart: transportMetadata.pickupWindowStart,
      pickupWindowEnd: transportMetadata.pickupWindowEnd,
      cargoPallets: transportMetadata.cargoPallets,
      cargoWeightKg: transportMetadata.cargoWeightKg,
      clientPrice: transportMetadata.clientPrice,
    }))
  } finally {
    try {
      if (orderId) await logistics.mutateSalesOrder('DELETE', orderId)
    } finally {
      try {
        await deleteQuoteIfExists(page.request, quoteId)
      } finally {
        await cleanupInboxFixture(fixture)
      }
    }
  }
})
