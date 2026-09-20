/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { LogisticsAgentInbox } from '../components/LogisticsAgentInbox'
import { seedAgreedOffer } from '../lib/agreed-offer'
import type { TransportRunView } from '../lib/transport-run-model'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({
  useAppEvent: jest.fn(),
}))
jest.mock('../components/TransportRunMap', () => ({
  TransportRunMap: () => <div data-testid="transport-run-map" />,
}))

function orderRun(): TransportRunView {
  const now = '2026-09-20T06:35:37.000Z'
  return {
    id: 'run-order-8',
    tenantId: 'tenant-1',
    organizationId: 'organization-1',
    sourceTransportId: 'transport-order-8',
    createdAt: now,
    updatedAt: now,
    stageEnteredAt: now,
    status: 'carrier_proposal_pending',
    agreedOffer: {
      ...seedAgreedOffer(),
      customerName: 'Presentation customer',
      customerReference: 'ORDER-20260920-00008',
    },
    orderId: 'agent-order-8',
    carrierStrategy: null,
    listing: null,
    vehicleHits: [],
    carrierProposal: null,
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
    route: null,
    capacity: null,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

test('identifies a converted Sales order separately from random demo jobs', async () => {
  jest.mocked(readApiResultOrThrow).mockResolvedValue({ items: [orderRun()], total: 1 })

  render(<LogisticsAgentInbox />)

  expect(await screen.findAllByText('Presentation customer')).toHaveLength(2)
  expect(screen.getAllByText(/logistics\.inbox\.sourceOrder.*ORDER-20260920-00008/)).toHaveLength(2)
  expect(screen.queryByText(/logistics\.inbox\.sourceDemo.*ORDER-20260920-00008/)).not.toBeInTheDocument()
})
