/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DispatcherPanel } from '../components/DispatcherPanel'
import { demoOffers, demoTransports } from '../lib/dispatcher-data'
import en from '../i18n/en.json'

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: jest.requireActual('./helpers/DispatcherDataTable').DispatcherDataTable,
}))

function renderPanel() {
  return render(<I18nProvider locale="en" dict={en}><DispatcherPanel /></I18nProvider>)
}

function openTransport(index = 0) {
  fireEvent.click(screen.getByRole('tab', { name: 'AI Transports', exact: true }))
  fireEvent.click(screen.getByRole('button', { name: `View details: ${demoTransports[index].id}` }))
  return screen.getByRole('dialog')
}

describe('Dispatcher demo interactions', () => {
  test('filters offers and opens details without creating an order', async () => {
    renderPanel()
    expect(screen.getByText(en['logistics.dispatcher.demoDescription'])).toBeVisible()
    expect(screen.getByRole('tab', { name: 'AI Inbox', exact: true })).toHaveAttribute('aria-selected', 'true')
    fireEvent.change(screen.getByPlaceholderText(en['logistics.dispatcher.searchOffers']), { target: { value: 'berlin' } })
    expect(screen.getByText(demoOffers[0].customer)).toBeVisible()
    expect(screen.queryByText(demoOffers[1].customer)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: `View details: ${demoOffers[0].id}` }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(demoOffers[0].customer)).toBeVisible()
    expect(within(dialog).getByText(en['logistics.dispatcher.offerNote'])).toBeVisible()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('button', { name: `View details: ${demoOffers[0].id}` })).toHaveFocus())
  })

  test('searches transports by order and shows a recoverable empty state', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('tab', { name: 'AI Transports', exact: true }))
    const search = screen.getByPlaceholderText(en['logistics.dispatcher.searchTransports'])
    fireEvent.change(search, { target: { value: demoTransports[1].order1.id.toLowerCase() } })
    expect(screen.getByText(demoTransports[1].customer)).toBeVisible()
    expect(screen.queryByText(demoTransports[0].customer)).not.toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'no-matching-route' } })
    expect(screen.getByText(en['logistics.dispatcher.emptyTitle'])).toBeVisible()
    fireEvent.change(search, { target: { value: '' } })
    expect(screen.getByText(demoTransports[0].customer)).toBeVisible()
  })

  test('requires carrier approval, deducts accepted cargo once, and resets the demo', async () => {
    renderPanel()
    const dialog = openTransport()
    expect(within(dialog).getByText(en['logistics.dispatcher.order1'])).toBeVisible()
    expect(within(dialog).getByText(en['logistics.dispatcher.order2'])).toBeVisible()
    expect(within(dialog).getByText(demoTransports[0].order2!.vehicle.registration, { exact: false })).toBeVisible()
    expect(within(dialog).getByText('13 pallets')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: en['logistics.dispatcher.acceptAdditional'] })).toBeDisabled()
    fireEvent.keyDown(dialog, { key: 'Enter', ctrlKey: true })
    expect(within(dialog).queryByRole('button', { name: en['logistics.dispatcher.approveCarrier'] })).not.toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Enter', metaKey: true })
    expect(within(dialog).getByText('9 pallets')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: en['logistics.dispatcher.acceptAdditional'] })).toBeDisabled()
    fireEvent.keyDown(dialog, { key: 'Enter', ctrlKey: true })
    expect(within(dialog).getByText('9 pallets')).toBeVisible()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: en['logistics.dispatcher.reset'] }))
    const resetDialog = openTransport()
    expect(within(resetDialog).getByRole('button', { name: en['logistics.dispatcher.approveCarrier'] })).toBeEnabled()
    expect(within(resetDialog).getByText('13 pallets')).toBeVisible()
  })

  test('keeps unknown vehicle capacity unavailable and resets state when remounted', () => {
    const panel = renderPanel()
    const unassigned = openTransport(2)
    expect(within(unassigned).getByText(en['logistics.dispatcher.noCarrier'])).toBeVisible()
    expect(within(unassigned).queryByRole('button', { name: en['logistics.dispatcher.approveCarrier'] })).not.toBeInTheDocument()
    panel.unmount()
    const nextPanel = renderPanel()
    const pending = openTransport()
    fireEvent.click(within(pending).getByRole('button', { name: en['logistics.dispatcher.approveCarrier'] }))
    nextPanel.unmount()
    renderPanel()
    expect(within(openTransport()).getByRole('button', { name: en['logistics.dispatcher.approveCarrier'] })).toBeEnabled()
  })
})
