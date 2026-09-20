/** @jest-environment node */

import { POST } from '../api/transport-runs/[id]/route'
import { resolveLogisticsRequestContext } from '../lib/request-context'
import {
  approveCarrierProposal,
  getTransportRun,
  toTransportRunView,
} from '../lib/transport-run'
import { seedAgreedOffer } from '../lib/agreed-offer'
import type { TransportRun } from '../lib/transport-run-model'

jest.mock('../lib/request-context', () => ({
  resolveLogisticsRequestContext: jest.fn(),
}))
jest.mock('../lib/transport-run', () => ({
  approveCarrierProposal: jest.fn(),
  getTransportRun: jest.fn(),
  toTransportRunView: jest.fn((run: TransportRun) => run),
  advanceTruck: jest.fn(),
  approveBackloadProposal: jest.fn(),
  emptyBackloadScanForReset: jest.fn(),
  proposeBackload: jest.fn(),
  proposeCarrier: jest.fn(),
  publishListingForRun: jest.fn(),
  rejectBackloadProposal: jest.fn(),
  rejectCarrierProposal: jest.fn(),
  scanBackloadsAlongRun: jest.fn(),
  searchVehiclesForRun: jest.fn(),
  startDelivery: jest.fn(),
  updateBackloadScanProgress: jest.fn(),
  DEMO_TRIP_STEP_PCT: 1,
}))

function pendingRun(sourceTransportId: string | null): TransportRun {
  const now = '2026-09-20T07:00:00.000Z'
  return {
    id: 'run-1',
    tenantId: 'tenant-1',
    organizationId: 'organization-1',
    sourceTransportId,
    createdAt: now,
    updatedAt: now,
    stageEnteredAt: now,
    status: 'carrier_proposal_pending',
    agreedOffer: {
      ...seedAgreedOffer(),
      customerReference: 'ORDER-20260920-00009',
      currencyCode: 'EUR',
      quoteNetEur: 1_500,
      lane: {
        ...seedAgreedOffer().lane,
        weightT: 18,
        pallets: 24,
      },
    },
    orderId: 'agent-order-1',
    carrierStrategy: 'active',
    listing: null,
    vehicleHits: [],
    carrierProposal: {
      id: 'proposal-1',
      source: 'active_vehicle_search',
      provider: 'trans',
      summary: 'Carrier proposal',
      rationale: 'Nearest available vehicle that fits the transport cargo and budget.',
      priceEur: 960,
      party: {
        companyName: 'Trans-Łódź Sp. z o.o.',
        contactName: 'Marek Nowak',
        phone: '+48 42 633 12 45',
        email: 'dyspozycja@trans-lodz.pl',
        addressLine: 'ul. Testowa 1',
        postalCode: '90-001',
        city: 'Łódź',
        country: 'PL',
        nip: '7251892345',
      },
      vehicle: {
        id: 'veh-lodz-1',
        provider: 'trans',
        locality: 'Łódź',
        country: 'PL',
        lat: 51.7592,
        lng: 19.456,
        radiusKm: 80,
        vehicleType: 'SEMI_TRAILER',
        capacityT: 24,
        availableFrom: now,
        remark: 'Available',
      },
      createdAt: now,
    },
    approvedCarrier: null,
    approvedAt: null,
    approvedBy: null,
    truck: null,
    backloadScan: {
      status: 'idle',
      radiusKm: 45,
      progressPct: 0,
      center: null,
      candidatesCount: 0,
      lastScanAt: null,
      aheadCandidateIds: [],
    },
    backloadProposal: null,
    acceptedBackloads: [],
    agentLog: [],
    history: [],
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

test('approving a carrier persists approved Order 2 before advancing the agent run', async () => {
  const run = pendingRun('20adbea5-0e64-4124-bf77-09630b8eda6f')
  const execute = jest.fn(async () => ({ result: { item: {} } }))
  jest.mocked(resolveLogisticsRequestContext).mockResolvedValue({
    container: { resolve: jest.fn(() => ({ execute })) } as never,
    em: {} as never,
    auth: { tenantId: 'tenant-1', sub: 'user-1' } as never,
    organizationScope: {
      selectedId: 'organization-1',
      filterIds: ['organization-1'],
      allowedIds: ['organization-1'],
      tenantId: 'tenant-1',
    },
    scope: { tenantId: 'tenant-1', organizationId: 'organization-1' },
  })
  jest.mocked(getTransportRun).mockReturnValue(run)
  jest.mocked(approveCarrierProposal).mockImplementation(() => ({ ...run, status: 'approved' }))

  const response = await POST(
    new Request('http://localhost/api/logistics/transport-runs/run-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve-carrier' }),
    }),
    { params: Promise.resolve({ id: 'run-1' }) },
  )

  expect(response.status).toBe(200)
  expect(execute).toHaveBeenCalledWith(
    'logistics.transports.approve_agent_carrier',
    expect.objectContaining({
      input: expect.objectContaining({
        id: '20adbea5-0e64-4124-bf77-09630b8eda6f',
        carrierName: 'Trans-Łódź Sp. z o.o.',
        carrierCost: 960,
        vehicleType: 'SEMI_TRAILER',
        vehicleCapacityKg: 24_000,
        exchangeSource: 'trans',
        exchangeRef: 'veh-lodz-1',
      }),
    }),
  )
  expect(execute.mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(approveCarrierProposal).mock.invocationCallOrder[0]!,
  )
  expect(toTransportRunView).toHaveBeenCalled()
})

test('approving a manual demo run does not create a Sales carrier order', async () => {
  const run = pendingRun(null)
  const execute = jest.fn()
  jest.mocked(resolveLogisticsRequestContext).mockResolvedValue({
    container: { resolve: jest.fn(() => ({ execute })) } as never,
    em: {} as never,
    auth: { tenantId: 'tenant-1', sub: 'user-1' } as never,
    organizationScope: {
      selectedId: 'organization-1',
      filterIds: ['organization-1'],
      allowedIds: ['organization-1'],
      tenantId: 'tenant-1',
    },
    scope: { tenantId: 'tenant-1', organizationId: 'organization-1' },
  })
  jest.mocked(getTransportRun).mockReturnValue(run)
  jest.mocked(approveCarrierProposal).mockImplementation(() => ({ ...run, status: 'approved' }))

  const response = await POST(
    new Request('http://localhost/api/logistics/transport-runs/run-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve-carrier' }),
    }),
    { params: Promise.resolve({ id: 'run-1' }) },
  )

  expect(response.status).toBe(200)
  expect(execute).not.toHaveBeenCalled()
  expect(approveCarrierProposal).toHaveBeenCalledWith('run-1', 'human2')
})

test('repeating approval repairs Order 2 for a run that already advanced', async () => {
  const approved = pendingRun('20adbea5-0e64-4124-bf77-09630b8eda6f')
  approved.status = 'backload_proposal_pending'
  approved.approvedCarrier = approved.carrierProposal
  const execute = jest.fn(async () => ({ result: { item: {} } }))
  jest.mocked(resolveLogisticsRequestContext).mockResolvedValue({
    container: { resolve: jest.fn(() => ({ execute })) } as never,
    em: {} as never,
    auth: { tenantId: 'tenant-1', sub: 'user-1' } as never,
    organizationScope: {
      selectedId: 'organization-1',
      filterIds: ['organization-1'],
      allowedIds: ['organization-1'],
      tenantId: 'tenant-1',
    },
    scope: { tenantId: 'tenant-1', organizationId: 'organization-1' },
  })
  jest.mocked(getTransportRun).mockReturnValue(approved)

  const response = await POST(
    new Request('http://localhost/api/logistics/transport-runs/run-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve-carrier' }),
    }),
    { params: Promise.resolve({ id: 'run-1' }) },
  )

  expect(response.status).toBe(200)
  expect(execute).toHaveBeenCalledWith('logistics.transports.approve_agent_carrier', expect.anything())
  expect(approveCarrierProposal).not.toHaveBeenCalled()
})
