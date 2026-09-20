'use client'

import * as React from 'react'
import { Bell, PackagePlus, Truck } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import type { BoardNotification } from '../../lib/routes-board'
import type { BoardDecision } from './useRoutesBoard'
import { vehicleLabel } from './RouteRow'

export function NotificationsPanel({ notifications, selectedId, decidingId, error, onSelect, onDecide }: {
  notifications: BoardNotification[]
  selectedId: string | null
  decidingId: string | null
  error: string | null
  onSelect: (transportId: string) => void
  onDecide: (notification: BoardNotification, action: BoardDecision) => void
}) {
  const t = useT()
  const locale = useLocale()
  const money = (value: number | null, currency: string) => value == null || value <= 0
    ? null
    : new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)
  const time = (iso: string) => new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(iso))

  return (
    <section className="flex min-h-80 flex-col rounded-lg border border-border bg-card" data-testid="board-notifications">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Bell className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t('logistics.board.notifications.title')}</h2>
        {notifications.length > 0 ? (
          <span className="ml-auto rounded-full bg-status-warning-bg px-2 py-0.5 text-xs font-semibold text-status-warning-text">
            {notifications.length}
          </span>
        ) : null}
      </header>
      {error ? <p role="alert" className="px-4 pt-3 text-sm text-status-error-text">{error}</p> : null}
      {notifications.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            title={t('logistics.board.notifications.empty.title')}
            description={t('logistics.board.notifications.empty.description')}
            icon={<Bell className="size-5" />}
          />
        </div>
      ) : (
        <ol className="divide-y divide-border overflow-y-auto">
          {notifications.map((notification) => {
            const isCarrier = notification.kind === 'carrier'
            const busy = decidingId === notification.id
            const selected = selectedId === notification.transportId
            const amount = money(notification.amount, notification.currencyCode)
            const cargo = [
              notification.pallets != null ? `${notification.pallets} EP` : null,
              notification.kg != null ? `${new Intl.NumberFormat(locale).format(notification.kg)} kg` : null,
            ].filter(Boolean).join(' · ')
            return (
              <li
                key={notification.id}
                className={cn('flex gap-3 px-4 py-3 transition-colors', selected && 'bg-primary/5')}
              >
                <span className={cn(
                  'mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full',
                  isCarrier ? 'bg-status-info-bg text-status-info-text' : 'bg-status-success-bg text-status-success-text',
                )}>
                  {isCarrier ? <Truck className="size-4" /> : <PackagePlus className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => onSelect(notification.transportId)}
                  >
                    <p className="text-sm font-semibold leading-snug">
                      {isCarrier
                        ? t('logistics.board.notifications.carrier', { carrier: notification.actorName, order: notification.transportOrderNumber })
                        : t('logistics.board.notifications.load', { customer: notification.actorName, order: notification.transportOrderNumber })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isCarrier ? notification.transportRoute : notification.route}
                      {isCarrier && vehicleLabel(notification.route, t) ? ` · ${vehicleLabel(notification.route, t)}` : ''}
                      {cargo ? ` · ${cargo}` : ''}
                      {amount ? ` · ${amount}` : ''}
                      {' · '}{time(notification.occurredAt)}
                    </p>
                    {!isCarrier && !notification.fits ? (
                      <p className="text-xs font-medium text-status-warning-text">{t('logistics.board.notifications.doesNotFit')}</p>
                    ) : null}
                  </button>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={Boolean(decidingId) || (!isCarrier && !notification.fits)}
                      onClick={() => onDecide(notification, isCarrier ? 'approve_carrier' : 'accept_load')}
                    >
                      {busy ? t('logistics.dispatcher.saving') : t('logistics.board.notifications.approve')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={Boolean(decidingId)}
                      onClick={() => onDecide(notification, isCarrier ? 'reject_carrier' : 'reject_load')}
                    >
                      {t('logistics.board.notifications.reject')}
                    </Button>
                    <Button asChild type="button" size="sm" variant="link" className="px-0">
                      <a href={`/backend/logistics/transports/${notification.transportId}`}>{t('logistics.board.notifications.open')}</a>
                    </Button>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
