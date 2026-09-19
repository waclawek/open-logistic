/** @jest-environment jsdom */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { apiCallOrThrow, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { DispatcherPanel } from '../components/DispatcherPanel'
import { demoOffers, demoTransports } from './helpers/dispatcher-fixtures'
import type { Offer, Transport } from '../lib/dispatcher-data'
import en from '../i18n/en.json'

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: jest.requireActual('./helpers/DispatcherDataTable').DispatcherDataTable,
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: jest.fn(), readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn(async (_headers: unknown, operation: () => Promise<unknown>) => operation()),
}))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: jest.fn(() => 0) }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

let persistedOffers: Offer[]
let persistedTransports: Transport[]

function renderPanel(initialTab: 'inbox' | 'transports' = 'inbox') {
  return render(<I18nProvider locale="en" dict={en}><DispatcherPanel initialTab={initialTab} /></I18nProvider>)
}

async function openTransport(index = 0) {
  fireEvent.click(screen.getByRole('tab', { name: 'AI Transports', exact: true }))
  fireEvent.click(await screen.findByRole('button', { name: `View details: ${demoTransports[index].reference}` }))
  const dialog = screen.getByRole('dialog')
  await within(dialog).findByRole('button', { name: `Accept additional load: ${demoOffers[0].reference}` })
  return dialog
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(useOrganizationScopeVersion).mockReturnValue(0)
  persistedOffers = JSON.parse(JSON.stringify(demoOffers)) as Offer[]
  persistedTransports = JSON.parse(JSON.stringify(demoTransports)) as Transport[]
  jest.mocked(readApiResultOrThrow).mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://localhost')
    const records = url.pathname.endsWith('/offers') ? persistedOffers : persistedTransports
    const search = url.searchParams.get('search')?.toLowerCase() ?? ''
    const items = records.filter((record) => JSON.stringify(record).toLowerCase().includes(search)
      && (!url.searchParams.has('available') || ('status' in record && ['new', 'review'].includes(record.status))))
    return { items, total: items.length, page: 1, totalPages: 1 }
  })
  jest.mocked(apiCallOrThrow).mockImplementation(async (input, init) => {
    const id = String(input).split('/').at(-2)
    const body = JSON.parse(String(init?.body)) as { action: string; offerId?: string }
    const transport = persistedTransports.find((record) => record.id === id)
    const offer = persistedOffers.find((record) => record.id === (body.offerId ?? id))
    if (transport?.order2) {
      if (body.action === 'approve_carrier') transport.order2.status = 'confirmed'
      if (body.action === 'reject_carrier') transport.order2.status = 'rejected'
      if (body.action === 'accept_load' && offer) {
        transport.additionalLoads.push({ id: offer.id, offerId: offer.id, orderNumber: transport.additionalLoads.length + 3, cargo: offer.cargo, status: 'confirmed' })
        offer.status = 'accepted'
      }
      transport.updatedAt = '2026-09-19T13:00:00.000Z'
    }
    if (body.action === 'reject' && offer) offer.status = 'rejected'
    return { ok: true, status: 200, result: { item: transport ?? offer }, response: {} as Response }
  })
})

describe('persisted dispatcher interactions', () => {
  test('loads and searches offers through the API, then rejects an offer persistently', async () => {
    const panel = renderPanel()
    await screen.findByText(demoOffers[0].customer)
    fireEvent.change(screen.getByPlaceholderText(en['logistics.dispatcher.searchOffers']), { target: { value: 'berlin' } })
    await waitFor(() => expect(screen.queryByText(demoOffers[1].customer)).not.toBeInTheDocument())
    expect(readApiResultOrThrow).toHaveBeenCalledWith(expect.stringContaining('search=berlin'))
    fireEvent.click(screen.getByRole('button', { name: `View details: ${demoOffers[0].reference}` }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject offer' }))
    await within(dialog).findByText('Rejected')
    expect(withScopedApiRequestHeaders).toHaveBeenCalledWith({ 'x-om-ext-optimistic-lock-expected-updated-at': demoOffers[0].updatedAt }, expect.any(Function))
    panel.unmount()
    renderPanel()
    await screen.findByText('Rejected')
  })

  test('accepts distinct offers as Order 3 and 4 and retains them after remount', async () => {
    const panel = renderPanel('transports')
    const dialog = await openTransport()
    expect(within(dialog).getByRole('button', { name: 'Accept additional load: OF-002' })).toBeDisabled()
    fireEvent.keyDown(dialog, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Accept additional load: OF-002' })).toBeEnabled())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept additional load: OF-002' }))
    await within(dialog).findByText('Order 3')
    expect(within(dialog).getByTestId('remaining-capacity')).toHaveTextContent('9 pallets')
    expect(within(dialog).getByRole('button', { name: 'Accept additional load: OF-001' })).toBeDisabled()
    persistedOffers[2].cargo = { weightKg: 1000, palletSpaces: 2 }
    panel.unmount()
    renderPanel('transports')
    const nextDialog = await openTransport()
    expect(within(nextDialog).getByText('Order 3')).toBeVisible()
    fireEvent.click(within(nextDialog).getByRole('button', { name: 'Accept additional load: OF-003' }))
    await within(nextDialog).findByText('Order 4')
    expect(within(nextDialog).getByTestId('remaining-capacity')).toHaveTextContent('7 pallets')
    await waitFor(() => expect(within(nextDialog).queryByRole('button', { name: 'Accept additional load: OF-002' })).not.toBeInTheDocument())
  })

  test('rejects a carrier and disables additional loads', async () => {
    renderPanel()
    const dialog = await openTransport()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject carrier' }))
    await within(dialog).findByText('Rejected')
    expect(within(dialog).getByRole('button', { name: 'Accept additional load: OF-002' })).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: 'Approve carrier' })).not.toBeInTheDocument()
  })

  test('surfaces write conflicts without applying the decision locally', async () => {
    renderPanel()
    const dialog = await openTransport()
    const conflict = { status: 409, body: { code: 'optimistic_lock_conflict' } }
    jest.mocked(apiCallOrThrow).mockRejectedValueOnce(conflict)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve carrier' }))
    await within(dialog).findByText(en['logistics.dispatcher.saveFailed'])
    expect(surfaceRecordConflict).toHaveBeenCalledWith(conflict, expect.any(Function))
    expect(within(dialog).getByRole('button', { name: 'Approve carrier' })).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: 'Accept additional load: OF-002' })).toBeDisabled()
  })

  test('shows load failures with a working retry', async () => {
    jest.mocked(readApiResultOrThrow).mockRejectedValueOnce(new Error('[internal] unavailable'))
    renderPanel()
    await screen.findByText(en['logistics.dispatcher.loadFailed'])
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText(demoOffers[0].customer)
    expect(screen.queryByText(en['logistics.dispatcher.loadFailed'])).not.toBeInTheDocument()
  })

  test('clears old organization records and ignores a late write conflict after switching scope', async () => {
    const panel = renderPanel()
    const dialog = await openTransport()
    let rejectDecision: ((reason: unknown) => void) | undefined
    jest.mocked(apiCallOrThrow).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDecision = reject }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve carrier' }))
    await waitFor(() => expect(apiCallOrThrow).toHaveBeenCalledTimes(1))
    jest.mocked(useOrganizationScopeVersion).mockReturnValue(1)
    jest.mocked(readApiResultOrThrow).mockResolvedValue({ items: [], total: 0, page: 1, totalPages: 1 })
    panel.rerender(<I18nProvider locale="en" dict={en}><DispatcherPanel /></I18nProvider>)
    expect(screen.queryByText(demoTransports[0].customer)).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await act(async () => { rejectDecision?.({ status: 409, body: { code: 'optimistic_lock_conflict' } }) })
    expect(surfaceRecordConflict).not.toHaveBeenCalled()
    expect(screen.queryByText(en['logistics.dispatcher.saveFailed'])).not.toBeInTheDocument()
  })

  test('does not show completion feedback in another record opened during a pending write', async () => {
    renderPanel()
    const dialog = await openTransport()
    let finishDecision: (() => void) | undefined
    jest.mocked(apiCallOrThrow).mockImplementationOnce(() => new Promise((resolve) => {
      finishDecision = () => resolve({ ok: true, status: 200, result: { item: persistedTransports[0] }, response: {} as Response })
    }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve carrier' }))
    await waitFor(() => expect(apiCallOrThrow).toHaveBeenCalledTimes(1))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const nextDialog = await openTransport(1)
    await act(async () => { finishDecision?.() })
    expect(within(nextDialog).queryByText(en['logistics.dispatcher.saved'])).not.toBeInTheDocument()
  })
})
