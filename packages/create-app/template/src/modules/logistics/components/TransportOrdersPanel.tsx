'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { LoadingMessage } from '@open-mercato/ui/backend/detail/LoadingMessage'
import { ErrorMessage } from '@open-mercato/ui/backend/detail/ErrorMessage'
import type { LogisticsOrder } from '../lib/types'
import { TransportOrderRouteMap } from './TransportOrderRouteMap'

type OrdersResponse = { items: LogisticsOrder[]; total: number }

function formatKm(m: number) {
  return `${(m / 1000).toFixed(1)} km`
}

function formatDuration(ms: number) {
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min} min`
  return `${(min / 60).toFixed(1)} h`
}

export function TransportOrdersPanel() {
  const t = useT()
  const [items, setItems] = useState<LogisticsOrder[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const data = await readApiResultOrThrow<OrdersResponse>('/api/logistics/orders?limit=50')
      setItems(data.items)
      setSelectedId((prev) => prev ?? data.items[0]?.id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('logistics.orders.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const runAction = async (action: 'demo-waw-poz' | 'from-inbox') => {
    setBusy(true)
    setError(null)
    try {
      const call = await apiCallOrThrow<{ order: LogisticsOrder }>('/api/logistics/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = call.result
      if (!data?.order) throw new Error(t('logistics.orders.error'))
      setItems((prev) => [data.order, ...prev.filter((o) => o.id !== data.order.id)])
      setSelectedId(data.order.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('logistics.orders.error'))
    } finally {
      setBusy(false)
    }
  }

  const selected = items.find((o) => o.id === selectedId) ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={busy}
          onClick={() => void runAction('demo-waw-poz')}
          data-testid="logistics-orders-demo"
        >
          {t('logistics.orders.createWawPoz')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void runAction('from-inbox')}
          data-testid="logistics-orders-from-inbox"
        >
          {t('logistics.orders.importInbox')}
        </Button>
        <Button type="button" variant="ghost" disabled={busy || loading} onClick={() => void load()}>
          {t('logistics.orders.refresh')}
        </Button>
        <span className="text-sm text-muted-foreground">
          {t('logistics.orders.count', { count: items.length })}
        </span>
      </div>

      <p className="text-sm text-muted-foreground">{t('logistics.orders.hint')}</p>

      {error ? <ErrorMessage label={error} /> : null}
      {loading ? <LoadingMessage label={t('logistics.orders.loading')} /> : null}

      {!loading && items.length === 0 ? (
        <EmptyState title={t('logistics.orders.empty')} />
      ) : null}

      {items.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_1fr]">
          <ul className="max-h-[28rem] space-y-1 overflow-auto rounded-md border border-border">
            {items.map((item) => {
              const pickup = item.stops.find((s) => s.role === 'pickup')
              const delivery = item.stops.find((s) => s.role === 'delivery')
              const active = item.id === selectedId
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 ${
                      active ? 'bg-muted' : ''
                    }`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <div className="font-medium">{item.referenceNumber}</div>
                    <div className="text-muted-foreground">
                      {pickup?.name ?? '?'} → {delivery?.name ?? '?'}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant="outline">{item.source}</Badge>
                      <Badge variant="secondary">{item.status}</Badge>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>

          {selected ? (
            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">{selected.referenceNumber}</h3>
                <Badge variant="outline">{selected.source}</Badge>
                {selected.route ? (
                  <Badge variant="secondary">
                    GraphHopper · {selected.route.source} · {formatKm(selected.route.distanceM)} ·{' '}
                    {formatDuration(selected.route.timeMs)}
                  </Badge>
                ) : null}
              </div>
              {selected.notes ? (
                <p className="text-sm text-muted-foreground">{selected.notes}</p>
              ) : null}
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                {selected.stops.map((stop) => (
                  <div key={`${stop.role}-${stop.lat}`} className="rounded-md bg-muted/40 p-2">
                    <dt className="font-medium capitalize">{stop.role}</dt>
                    <dd>
                      {stop.name}
                      {stop.street ? ` · ${stop.street} ${stop.number ?? ''}`.trim() : ''}
                      <br />
                      <span className="text-muted-foreground">
                        {stop.lat.toFixed(4)}, {stop.lng.toFixed(4)}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
              <TransportOrderRouteMap order={selected} />
              {selected.route?.instructions?.length ? (
                <details className="text-sm">
                  <summary className="cursor-pointer font-medium">
                    {t('logistics.orders.instructions', {
                      count: selected.route.instructions.length,
                    })}
                  </summary>
                  <ol className="mt-2 max-h-40 list-decimal space-y-1 overflow-auto pl-5 text-muted-foreground">
                    {selected.route.instructions.slice(0, 12).map((ins, idx) => (
                      <li key={`${idx}-${ins.text}`}>{ins.text}</li>
                    ))}
                    {selected.route.instructions.length > 12 ? <li>…</li> : null}
                  </ol>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
