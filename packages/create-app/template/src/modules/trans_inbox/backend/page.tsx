'use client'

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import type { TransInboxRequest } from '../lib/inbox-store'

type FeedResponse = { items: TransInboxRequest[]; total: number; max: number; enabled: boolean }
type FeedState = { scopeVersion: number; data: FeedResponse }

export default function TransInboxPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [feed, setFeed] = React.useState<FeedState | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const requestVersion = React.useRef(0)
  const mounted = React.useRef(true)
  const scopeRef = React.useRef(scopeVersion)
  scopeRef.current = scopeVersion
  const items = feed?.scopeVersion === scopeVersion ? feed.data.items : []
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null

  const refresh = React.useCallback(async () => {
    const version = ++requestVersion.current
    try {
      const data = await readApiResultOrThrow<FeedResponse>('/api/trans_inbox/feed?limit=100')
      if (!mounted.current || version !== requestVersion.current || scopeVersion !== scopeRef.current) return
      setFeed({ scopeVersion, data })
      setError(null)
    } catch {
      if (mounted.current && version === requestVersion.current && scopeVersion === scopeRef.current) {
        setFeed(null)
        setError(t('trans_inbox.page.error'))
      }
    } finally {
      if (mounted.current && version === requestVersion.current && scopeVersion === scopeRef.current) setLoading(false)
    }
  }, [scopeVersion, t])

  React.useEffect(() => {
    mounted.current = true
    setLoading(true)
    setSelectedId(null)
    setError(null)
    void refresh()
    const timer = window.setInterval(() => void refresh(), 3000)
    return () => {
      mounted.current = false
      requestVersion.current += 1
      window.clearInterval(timer)
    }
  }, [refresh])

  useAppEvent('trans_inbox.request.received', () => void refresh(), [refresh])

  const columns = React.useMemo<ColumnDef<TransInboxRequest>[]>(() => [
    { accessorKey: 'receivedAt', header: t('trans_inbox.page.receivedAt'), cell: ({ row }) => new Date(row.original.receivedAt).toLocaleTimeString() },
    { accessorKey: 'source', header: t('trans_inbox.page.source') },
    { accessorKey: 'channel', header: t('trans_inbox.page.channel'), meta: { truncate: true, maxWidth: '16rem' } },
    { accessorKey: 'bytes', header: t('trans_inbox.page.bytes') },
  ], [t])

  return (
    <Page>
      <PageHeader
        title={t('trans_inbox.adminTitle')}
        description={t('trans_inbox.page.subtitle')}
        actions={<Button type="button" variant="outline" onClick={() => void refresh()}>{t('trans_inbox.page.refresh')}</Button>}
      />
      <PageBody>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('trans_inbox.page.diagnosticHint')}</p>
          {feed?.scopeVersion === scopeVersion && !feed.data.enabled ? (
            <p className="text-sm text-muted-foreground">{t('trans_inbox.page.disabled')}</p>
          ) : null}
          {error ? <ErrorMessage label={error} /> : null}
          <DataTable
            columns={columns}
            data={items}
            isLoading={loading}
            extensionTableId="trans_inbox.requests"
            onRowClick={(item) => setSelectedId(item.id)}
            emptyState={<EmptyState title={t('trans_inbox.page.empty')} />}
            rowActions={(item) => <RowActions items={[{ id: 'open', label: t('trans_inbox.page.open'), onSelect: () => setSelectedId(item.id) }]} />}
          />
          {selected ? (
            <section className="space-y-4 rounded-lg border border-border p-4" aria-label={t('trans_inbox.page.details')}>
              <SectionHeader title={t('trans_inbox.page.details')} />
              <p className="break-all font-mono text-sm">{selected.method} {selected.path}</p>
              <p className="text-sm text-muted-foreground">{selected.receivedAt}</p>
              <SectionHeader title={t('trans_inbox.page.headers')} />
              <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(selected.headers, null, 2)}</pre>
              <SectionHeader title={t('trans_inbox.page.body')} />
              <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(selected.body, null, 2)}</pre>
            </section>
          ) : null}
        </div>
      </PageBody>
    </Page>
  )
}
