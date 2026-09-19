/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import TransInboxPage from '../backend/page'
import type { TransInboxRequest } from '../lib/inbox-store'

let mockScopeVersion = 0
jest.mock('@open-mercato/shared/lib/i18n/context', () => { const translate = (key: string) => key; return { useT: () => translate } })
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => mockScopeVersion }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ readApiResultOrThrow: jest.fn() }))
jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({ useAppEvent: jest.fn() }))
jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: React.PropsWithChildren) => <main>{children}</main>,
  PageBody: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  PageHeader: ({ title, actions }: { title: string; actions: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
}))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ data, onRowClick, emptyState }: { data: TransInboxRequest[]; onRowClick: (item: TransInboxRequest) => void; emptyState: React.ReactNode }) => (
    <div>{data.length ? data.map((item) => <button key={item.id} onClick={() => onRowClick(item)}>{item.channel}</button>) : emptyState}</div>
  ),
}))
jest.mock('@open-mercato/ui/backend/SectionHeader', () => ({ SectionHeader: ({ title }: { title: string }) => <h2>{title}</h2> }))
jest.mock('@open-mercato/ui/backend/EmptyState', () => ({ EmptyState: ({ title }: { title: string }) => <p>{title}</p> }))
jest.mock('@open-mercato/ui/backend/detail', () => ({ ErrorMessage: ({ label }: { label: string }) => <div role="alert">{label}</div> }))
jest.mock('@open-mercato/ui/primitives/button', () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }))
jest.mock('@open-mercato/ui/backend/RowActions', () => ({ RowActions: () => null }))

const item = { id: 'request-one', channel: 'freight', source: 'trans', method: 'POST', path: '/api/integrations/trans/webhooks/freight', receivedAt: '2026-09-19T10:00:00Z', headers: {}, body: { reference: 'synthetic-123' }, bytes: 10 }
const empty = { items: [], total: 0, max: 100, enabled: false }

beforeEach(() => {
  jest.clearAllMocks()
  mockScopeVersion = 0
})

it('shows disabled capture and empty state without a destructive action', async () => {
  jest.mocked(readApiResultOrThrow).mockResolvedValue(empty)
  render(<TransInboxPage />)
  await screen.findByText('trans_inbox.page.disabled')
  expect(screen.getByText('trans_inbox.page.empty')).toBeInTheDocument()
  expect(screen.queryByText('trans_inbox.page.clear')).not.toBeInTheDocument()
})

it('loads the scoped feed and displays selected sanitized details', async () => {
  jest.mocked(readApiResultOrThrow).mockResolvedValue({ items: [item], total: 1, max: 100, enabled: true })
  render(<TransInboxPage />)
  await screen.findByText('freight')
  fireEvent.click(screen.getByText('freight'))
  expect(screen.getByText(/synthetic-123/)).toBeInTheDocument()
  expect(readApiResultOrThrow).toHaveBeenCalledWith('/api/trans_inbox/feed?limit=100')
})

it('immediately hides old organization details while loading a new scope', async () => {
  jest.mocked(readApiResultOrThrow).mockResolvedValueOnce({ items: [item], total: 1, max: 100, enabled: true })
  const { rerender } = render(<TransInboxPage />)
  await screen.findByText(/synthetic-123/)
  let complete: (value: typeof empty) => void = () => undefined
  jest.mocked(readApiResultOrThrow).mockReturnValue(new Promise((resolve) => { complete = resolve }))
  mockScopeVersion = 1
  rerender(<TransInboxPage />)
  expect(screen.queryByText(/synthetic-123/)).not.toBeInTheDocument()
  await act(async () => { complete(empty) })
  await waitFor(() => expect(screen.getByText('trans_inbox.page.disabled')).toBeInTheDocument())
})
