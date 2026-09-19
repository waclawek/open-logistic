/** @jest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { apiCall, apiCallOrThrow, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { TransportDetailView } from '../components/TransportDetail'
import { TransportsTable } from '../components/TransportsTable'
import { demoOffers } from './helpers/dispatcher-fixtures'
import type { TransportDetail, TransportRow } from '../types'
import en from '../i18n/en.json'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({ DataTable: jest.requireActual('./helpers/DispatcherDataTable').DispatcherDataTable }))
jest.mock('@open-mercato/ui/backend/detail', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/detail/ErrorMessage'),
  ...jest.requireActual('@open-mercato/ui/backend/detail/LoadingMessage'),
  ...jest.requireActual('@open-mercato/ui/backend/detail/RecordNotFoundState'),
}))
jest.mock('@open-mercato/ui/backend/forms', () => ({ FormHeader: ({ title }: { title: string }) => <h1>{title}</h1> }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(), apiCallOrThrow: jest.fn(), readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn(async (_headers: unknown, operation: () => Promise<unknown>) => operation()),
}))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: jest.fn(() => 0) }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({ useGuardedMutation: () => ({
  runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(), retryLastMutation: jest.fn(),
}) }))

let transport: TransportDetail
const response = <Value,>(result: Value) => ({ ok: true, status: 200, result, response: {} as Response, cacheStatus: null })
const renderDetail = () => render(<I18nProvider locale="en" dict={en}><TransportDetailView transportId="client-order" /></I18nProvider>)

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(useOrganizationScopeVersion).mockReturnValue(0)
  transport = {
    transportVersion: 'a'.repeat(64),
    updatedAt: '2026-09-19T12:30:00.000Z',
    order1: { id: 'client-order', orderNumber: 'SALE-001', status: 'confirmed', customerId: null, customerName: 'Acme', currencyCode: 'EUR', updatedAt: '2026-09-19T12:00:00.000Z', fields: { pickup_address: 'Warsaw', delivery_address: 'Berlin', cargo_pallets: 10, cargo_weight_kg: 4000, client_price: 1400 } },
    order2: { id: 'carrier-order', orderNumber: 'SALE-002', status: 'pending_approval', customerId: null, customerName: 'Carrier', currencyCode: 'EUR', updatedAt: '2026-09-19T12:00:00.000Z', fields: { vehicle_capacity_pallets: 33, vehicle_capacity_kg: 24000, carrier_cost: 900 } },
    additionalLoads: [], carrierHistory: [], freeSpace: { pallets: 23, kg: 20000, limiting: 'pallets' },
  }
  jest.mocked(apiCall).mockImplementation(async () => response({ item: JSON.parse(JSON.stringify(transport)) as TransportDetail }))
  jest.mocked(readApiResultOrThrow).mockResolvedValue({ items: demoOffers, total: demoOffers.length, page: 1, totalPages: 1 })
  jest.mocked(apiCallOrThrow).mockImplementation(async (_input, init) => {
    const decision = JSON.parse(String(init?.body)) as { action: string; offerId?: string; orderId?: string }
    if (decision.action === 'approve_carrier' && transport.order2) transport.order2.status = 'approved'
    if (decision.action === 'reject_carrier') { if (transport.order2) transport.carrierHistory.push({ ...transport.order2, status: 'rejected' }); transport.order2 = null }
    if (decision.action === 'accept_load') {
      const offer = demoOffers.find((item) => item.id === decision.offerId)
      if (offer) {
        transport.additionalLoads.push({ ...transport.order1, id: offer.id, orderNumber: `SALE-${offer.reference}`, status: 'approved', fields: { transport_order_number: transport.additionalLoads.length + 3, cargo_pallets: offer.cargo.palletSpaces, cargo_weight_kg: offer.cargo.weightKg } })
        transport.freeSpace = { pallets: transport.freeSpace!.pallets! - offer.cargo.palletSpaces, kg: transport.freeSpace!.kg! - offer.cargo.weightKg, limiting: 'pallets' }
        jest.mocked(readApiResultOrThrow).mockResolvedValue({ items: demoOffers.filter((item) => !transport.additionalLoads.some((order) => order.id === item.id)), total: 1, page: 1, totalPages: 1 })
      }
    }
    transport.order1.updatedAt = '2026-09-19T13:00:00.000Z'
    transport.updatedAt = '2026-09-19T13:00:00.000Z'
    return response({ item: JSON.parse(JSON.stringify(transport)) as TransportDetail })
  })
})

test('navigates from a Sales transport row to its dedicated detail route', async () => {
  const row: TransportRow = { id: 'client-order', orderNumber: 'SALE-001', customerName: 'Acme', currencyCode: 'EUR', pickupAddress: 'Warsaw', deliveryAddress: 'Berlin', pickupWindowStart: null, pickupWindowEnd: null, cargoPallets: 10, cargoWeightKg: 4000, clientPrice: 1400, carrier: null, freeSpace: null, additionalLoads: { pending: 0, approved: 0, pendingOrderId: null, pendingUpdatedAt: null }, updatedAt: transport.order1.updatedAt }
  jest.mocked(apiCallOrThrow).mockResolvedValue(response({ items: [row], total: 1, page: 1, pageSize: 25 }))
  render(<I18nProvider locale="en" dict={en}><TransportsTable /></I18nProvider>)
  expect(await screen.findByRole('link', { name: 'SALE-001' })).toHaveAttribute('href', '/backend/logistics/transports/client-order')
  expect(screen.getByRole('heading', { level: 1, name: en['logistics.transports.title'], exact: true })).toBeVisible()
  expect(screen.getByText(en['logistics.transports.description'])).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Pending carriers' }))
  await waitFor(() => expect(apiCallOrThrow).toHaveBeenLastCalledWith(expect.stringContaining('carrierStatus=pending_approval'), expect.anything(), expect.anything()))
  fireEvent.click(screen.getByRole('button', { name: 'Sort pickup' }))
  await waitFor(() => expect(apiCallOrThrow).toHaveBeenLastCalledWith(expect.stringContaining('sortField=pickupWindowStart&sortDir=asc'), expect.anything(), expect.anything()))
  fireEvent.change(screen.getByPlaceholderText(en['logistics.transports.search']), { target: { value: 'Berlin' } })
  await waitFor(() => expect(apiCallOrThrow).toHaveBeenLastCalledWith(expect.stringContaining('search=Berlin'), expect.anything(), expect.anything()))
})

test('approves the carrier with aggregate version and accepts successive persisted offers', async () => {
  const view = renderDetail()
  const first = await screen.findByRole('button', { name: `Accept additional load: ${demoOffers[0].reference}` })
  expect(first).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Approve carrier' }))
  await waitFor(() => expect(first).toBeEnabled())
  expect(withScopedApiRequestHeaders).toHaveBeenCalledWith({ 'x-om-ext-optimistic-lock-expected-updated-at': '2026-09-19T12:30:00.000Z' }, expect.any(Function))
  expect(apiCallOrThrow).toHaveBeenCalledWith('/api/logistics/transports/client-order/decision', expect.objectContaining({ body: JSON.stringify({ action: 'approve_carrier', transportVersion: 'a'.repeat(64) }) }))
  fireEvent.click(first)
  await screen.findByText('Order 3')
  const second = screen.getByRole('button', { name: `Accept additional load: ${demoOffers[1].reference}` })
  expect(second).toBeEnabled()
  fireEvent.click(second)
  await screen.findByText('Order 4')
  view.unmount()
  renderDetail()
  expect(await screen.findByText('Order 3')).toBeVisible()
})

test('rejects an offer using its own version, and carrier rejection disables loads', async () => {
  renderDetail()
  fireEvent.click(await screen.findByRole('button', { name: `Reject offer: ${demoOffers[0].reference}` }))
  await waitFor(() => expect(apiCallOrThrow).toHaveBeenCalledWith(`/api/logistics/offers/${demoOffers[0].id}/decision`, expect.objectContaining({ body: JSON.stringify({ action: 'reject' }) })))
  expect(withScopedApiRequestHeaders).toHaveBeenCalledWith({ 'x-om-ext-optimistic-lock-expected-updated-at': demoOffers[0].updatedAt }, expect.any(Function))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Reject carrier' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Reject carrier' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve carrier' })).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: `Accept additional load: ${demoOffers[0].reference}` })).toBeDisabled()
})

test('surfaces conflicts without applying a decision', async () => {
  renderDetail()
  const conflict = { status: 409, body: { code: 'optimistic_lock_conflict' } }
  jest.mocked(apiCallOrThrow).mockRejectedValueOnce(conflict)
  fireEvent.click(await screen.findByRole('button', { name: 'Approve carrier' }))
  await screen.findByText(en['logistics.dispatcher.saveFailed'])
  expect(surfaceRecordConflict).toHaveBeenCalledWith(conflict, expect.any(Function))
  expect(screen.getByRole('button', { name: `Accept additional load: ${demoOffers[0].reference}` })).toBeDisabled()
})

test('clears old organization data immediately and ignores late mutation feedback', async () => {
  const view = renderDetail()
  let rejectDecision: ((reason: unknown) => void) | undefined
  jest.mocked(apiCallOrThrow).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDecision = reject }))
  fireEvent.click(await screen.findByRole('button', { name: 'Approve carrier' }))
  jest.mocked(useOrganizationScopeVersion).mockReturnValue(1)
  jest.mocked(apiCall).mockImplementationOnce(() => new Promise(() => {}))
  view.rerender(<I18nProvider locale="en" dict={en}><TransportDetailView transportId="client-order" /></I18nProvider>)
  expect(screen.queryByText('Acme')).not.toBeInTheDocument()
  await act(async () => { rejectDecision?.({ status: 409 }) })
  expect(surfaceRecordConflict).not.toHaveBeenCalled()
})

test('renders a missing-record recovery state without record actions', async () => {
  jest.mocked(apiCall).mockResolvedValue({ ...response(null), ok: false, status: 404 })
  renderDetail()
  expect(await screen.findByText(en['logistics.transport.notFound'])).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Approve carrier' })).not.toBeInTheDocument()
})

test('keeps offer acceptance unavailable while the client order is unconfirmed', async () => {
  transport.order1.status = 'pending_approval'
  transport.order2!.status = 'approved'
  renderDetail()
  expect(await screen.findByRole('button', { name: `Accept additional load: ${demoOffers[0].reference}` })).toBeDisabled()
})

test('supports approval and rejection of pending Sales load proposals', async () => {
  transport.order2!.status = 'approved'
  transport.additionalLoads = [{ ...transport.order1, id: 'pending-load', orderNumber: 'SALE-003', status: 'pending_approval', fields: { cargo_pallets: 2, cargo_weight_kg: 1000 } }]
  renderDetail()
  fireEvent.click(await screen.findByRole('button', { name: 'Accept additional load: SALE-003' }))
  await waitFor(() => expect(apiCallOrThrow).toHaveBeenCalledWith('/api/logistics/transports/client-order/decision', expect.objectContaining({ body: JSON.stringify({ action: 'accept_load', orderId: 'pending-load', transportVersion: transport.transportVersion }) })))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Reject additional load: SALE-003' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Reject additional load: SALE-003' }))
  await waitFor(() => expect(apiCallOrThrow).toHaveBeenCalledWith('/api/logistics/transports/client-order/decision', expect.objectContaining({ body: JSON.stringify({ action: 'reject_load', orderId: 'pending-load', transportVersion: transport.transportVersion }) })))
})
