'use client'

import * as React from 'react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { LoadingMessage } from '@open-mercato/ui/backend/detail/LoadingMessage'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import type { TransInboxRequest } from '../lib/inbox-store'

type FeedResponse = {
  items: TransInboxRequest[]
  total: number
  max: number
  broadcastTenantConfigured: boolean
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString()
  } catch {
    return iso
  }
}

export default function TransInboxPage() {
  const t = useT()
  const [items, setItems] = React.useState<TransInboxRequest[]>([])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [broadcastConfigured, setBroadcastConfigured] = React.useState(false)
  const [livePulse, setLivePulse] = React.useState(false)
  const [clearing, setClearing] = React.useState(false)

  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null

  const refresh = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    setError(null)
    try {
      const data = await readApiResultOrThrow<FeedResponse>('/api/trans_inbox/feed?limit=150')
      setItems(data.items)
      setBroadcastConfigured(data.broadcastTenantConfigured)
      setSelectedId((prev) => {
        if (prev && data.items.some((item) => item.id === prev)) return prev
        return data.items[0]?.id ?? null
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('trans_inbox.page.error'))
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh({ silent: true })
    }, 1500)
    return () => window.clearInterval(timer)
  }, [refresh])

  useAppEvent(
    'trans_inbox.request.received',
    (event) => {
      const payload = event.payload as { request?: TransInboxRequest }
      if (!payload.request?.id) return
      setLivePulse(true)
      window.setTimeout(() => setLivePulse(false), 600)
      setItems((prev) => {
        if (prev.some((item) => item.id === payload.request!.id)) return prev
        return [payload.request!, ...prev].slice(0, 300)
      })
      setSelectedId((prev) => prev ?? payload.request!.id)
    },
    [],
  )

  useAppEvent(
    'trans_inbox.feed.cleared',
    () => {
      setItems([])
      setSelectedId(null)
    },
    [],
  )

  const { runMutation } = useGuardedMutation({ contextId: 'trans_inbox.feed' })

  const onClear = async () => {
    setClearing(true)
    try {
      await runMutation({
        operation: async () => readApiResultOrThrow('/api/trans_inbox/feed', { method: 'DELETE' }),
        context: { entity: 'trans_inbox.feed' },
      })
      setItems([])
      setSelectedId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('trans_inbox.page.error'))
    } finally {
      setClearing(false)
    }
  }

  return (
    <Page>
      <PageHeader
        title={t('trans_inbox.adminTitle', 'Trans Inbox')}
        description={t('trans_inbox.page.subtitle', 'Live feed of Trans.eu simulator webhooks hitting this app.')}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={livePulse ? 'default' : 'secondary'} size="sm">
              {broadcastConfigured ? t('trans_inbox.page.live') : t('trans_inbox.page.polling')}
            </Badge>
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
              {t('trans_inbox.page.refresh')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={clearing || items.length === 0}
              onClick={() => void onClear()}
            >
              {t('trans_inbox.page.clear')}
            </Button>
          </div>
        }
      />
      <PageBody>
        <div className="mb-4 space-y-1 text-sm text-muted-foreground">
          <div>{t('trans_inbox.page.endpoints', 'POST /api/integrations/{trans|timocom}/webhooks/{channel}')}</div>
          <div>{t('trans_inbox.page.count', { count: items.length })}</div>
          {!broadcastConfigured ? <div>{t('trans_inbox.page.sseHint')}</div> : null}
        </div>

        {loading && items.length === 0 ? (
          <LoadingMessage label={t('trans_inbox.page.loading')} />
        ) : null}

        {error ? <ErrorMessage label={error} /> : null}

        {!loading && !error && items.length === 0 ? (
          <EmptyState title={t('trans_inbox.page.empty')} />
        ) : null}

        {items.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <div className="max-h-[70vh] overflow-auto rounded-md border border-border">
              <ul className="divide-y divide-border">
                {items.map((item) => {
                  const active = selected?.id === item.id
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 ${
                          active ? 'bg-muted' : ''
                        }`}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" size="sm">
                              {item.source || 'trans'}
                            </Badge>
                            <Badge variant="secondary" size="sm">
                              {item.channel}
                            </Badge>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatTime(item.receivedAt)}
                          </span>
                        </div>
                        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                          {item.method} {item.path}
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="rounded-md border border-border p-4">
              {selected ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{selected.source || 'trans'}</Badge>
                    <Badge variant="secondary">{selected.channel}</Badge>
                    <StatusBadge variant="success" dot>
                      {t('trans_inbox.page.statusAccepted', 'Accepted')}
                    </StatusBadge>
                    <span className="text-xs text-muted-foreground">{selected.id}</span>
                  </div>
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">{t('trans_inbox.page.receivedAt')}</dt>
                      <dd>{selected.receivedAt}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t('trans_inbox.page.bytes')}</dt>
                      <dd>{selected.bytes}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-muted-foreground">{t('trans_inbox.page.channel')}</dt>
                      <dd className="font-mono text-xs">
                        {selected.method} {selected.path}
                      </dd>
                    </div>
                  </dl>
                  <div>
                    <div className="mb-1 text-sm font-medium">{t('trans_inbox.page.headers')}</div>
                    <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 text-xs">
                      {JSON.stringify(selected.headers, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 text-sm font-medium">{t('trans_inbox.page.body')}</div>
                    <pre className="max-h-[28rem] overflow-auto rounded-md bg-muted p-3 text-xs">
                      {typeof selected.body === 'string'
                        ? selected.body
                        : JSON.stringify(selected.body, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : (
                <EmptyState title={t('trans_inbox.page.noSelection')} />
              )}
            </div>
          </div>
        ) : null}
      </PageBody>
    </Page>
  )
}
