'use client'

import * as React from 'react'
import { RefreshCw, Route } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { FleetMap } from './FleetMap'
import { NotificationsPanel } from './NotificationsPanel'
import { RouteRow, rowDomId } from './RouteRow'
import { useRoutesBoard } from './useRoutesBoard'

/**
 * AI Routes: the board of transports on top (carrier → client order + loads),
 * decisions waiting for the dispatcher bottom-left, the fleet map bottom-right.
 */
export function RoutesBoard() {
  const t = useT()
  const board = useRoutesBoard()
  const [selectedId, setSelectedId] = React.useState<string | null>(null)

  const select = React.useCallback((transportId: string, scroll = false) => {
    setSelectedId(transportId)
    if (!scroll) return
    document.getElementById(rowDomId(transportId))?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  const pendingCarriers = board.items.filter((item) => item.carrier?.status === 'pending_approval').length
  const withoutCarrier = board.items.filter((item) => !item.carrier).length

  return (
    <div className="flex flex-col gap-4" data-testid="routes-board">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold">{t('logistics.board.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('logistics.board.description')}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{t('logistics.board.stats', { total: board.items.length, withoutCarrier, pendingCarriers })}</span>
          <Button type="button" size="sm" variant="outline" onClick={board.reload} disabled={board.loading}>
            <RefreshCw className="size-3.5" />
            {t('logistics.actions.refresh')}
          </Button>
        </div>
      </header>

      <section className="rounded-lg border border-border bg-card p-3" data-testid="board-rows">
        <div className="mb-2 grid grid-cols-1 gap-3 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid-cols-[minmax(200px,260px)_auto_1fr]">
          <span>{t('logistics.board.columns.carrier')}</span>
          <span className="hidden w-5 md:block" />
          <span>{t('logistics.board.columns.orders')}</span>
        </div>
        {board.error && board.items.length === 0 ? (
          <ErrorMessage
            label={board.error}
            action={<Button type="button" size="sm" variant="outline" onClick={board.reload}>{t('logistics.actions.retry')}</Button>}
          />
        ) : board.loading && board.items.length === 0 ? (
          <LoadingMessage label={t('logistics.board.loading')} />
        ) : board.items.length === 0 ? (
          <EmptyState
            title={t('logistics.transports.empty.title')}
            description={t('logistics.board.empty.description')}
            icon={<Route className="size-5" />}
          />
        ) : (
          <ol className="flex flex-col gap-2">
            {board.items.map((item) => (
              <RouteRow key={item.id} item={item} selected={selectedId === item.id} onSelect={(id) => select(id)} />
            ))}
          </ol>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <NotificationsPanel
          notifications={board.notifications}
          selectedId={selectedId}
          decidingId={board.decidingId}
          error={board.decisionError}
          onSelect={(transportId) => select(transportId, true)}
          onDecide={(notification, action) => void board.decide(notification, action)}
        />
        <FleetMap items={board.items} selectedTransportId={selectedId} />
      </div>
    </div>
  )
}
