'use client'

import * as React from 'react'
import { ArrowRight, Plus, Truck } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { cn } from '@open-mercato/shared/lib/utils'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { LoadPill, RouteBoardItem } from '../../lib/routes-board'
import { formatRoute } from '../../lib/routes-board'

export function rowDomId(transportId: string): string {
  return `route-row-${transportId}`
}

function statusVariant(status: string): StatusBadgeVariant {
  if (status === 'approved' || status === 'confirmed') return 'success'
  if (status === 'pending_approval') return 'warning'
  if (status === 'rejected' || status === 'cancelled') return 'error'
  return 'neutral'
}

function formatCargo(pallets: number | null, kg: number | null, locale: string): string {
  const parts: string[] = []
  if (pallets != null) parts.push(`${pallets} EP`)
  if (kg != null) parts.push(`${new Intl.NumberFormat(locale).format(kg)} kg`)
  return parts.join(' · ')
}

function formatMoney(value: number | null, currencyCode: string, locale: string): string | null {
  if (value == null || value <= 0) return null
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode, maximumFractionDigits: 0 }).format(value)
}

/** The rounded "order" chip used for the client order and every additional load. */
function OrderPill({ title, route, cargo, price, pending, href, primary }: {
  title: string
  route: string
  cargo: string
  price: string | null
  pending?: boolean
  href?: string
  primary?: boolean
}) {
  const className = cn(
    'inline-flex max-w-full flex-col gap-0.5 rounded-full border px-4 py-1.5 text-left text-sm transition-colors',
    primary ? 'border-primary/40 bg-primary/5' : 'bg-card',
    pending && 'border-dashed text-muted-foreground',
    href && 'hover:border-primary hover:bg-primary/10',
  )
  const body = (
    <>
      <span className="flex items-center gap-2 font-semibold leading-tight">
        <span className="truncate">{title}</span>
        {price ? <span className="font-normal text-muted-foreground">{price}</span> : null}
      </span>
      <span className="truncate text-xs text-muted-foreground">{route}{cargo ? ` · ${cargo}` : ''}</span>
    </>
  )
  return href ? <a href={href} className={className}>{body}</a> : <span className={className}>{body}</span>
}

/** Seeded vehicle types are stored as i18n keys (`logistics.dispatcher.vehicle.*`); free text stays as is. */
export function vehicleLabel(value: string | null, t: (key: string) => string): string | null {
  if (!value) return null
  return value.startsWith('logistics.') ? t(value) : value
}

export function RouteRow({ item, selected, onSelect }: {
  item: RouteBoardItem
  selected: boolean
  onSelect: (id: string) => void
}) {
  const t = useT()
  const locale = useLocale()
  const detailHref = `/backend/logistics/transports/${item.id}`
  const loads = item.loads
  const pendingPlaceholders = loads.length === 0 ? item.loadCounts.approved + item.loadCounts.pending : 0
  const freeSpace = item.freeSpace
  const overloaded = Boolean(freeSpace && ((freeSpace.pallets != null && freeSpace.pallets < 0) || (freeSpace.kg != null && freeSpace.kg < 0)))

  return (
    <li
      id={rowDomId(item.id)}
      data-testid="route-row"
      onClick={() => onSelect(item.id)}
      className={cn(
        'grid cursor-pointer grid-cols-1 items-center gap-3 rounded-lg border border-border bg-background p-3 transition-shadow md:grid-cols-[minmax(200px,260px)_auto_1fr]',
        selected && 'ring-2 ring-primary',
      )}
    >
      <div className="min-w-0">
        {item.carrier ? (
          <div className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2">
            <Truck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{item.carrier.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[vehicleLabel(item.carrier.vehicleType, t), formatMoney(item.carrier.cost, item.currencyCode, locale)].filter(Boolean).join(' · ') || t('logistics.board.carrier.noDetails')}
              </p>
              <StatusBadge variant={statusVariant(item.carrier.status)} dot className="mt-1">
                {t(`logistics.status.${item.carrier.status}`)}
              </StatusBadge>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            <Truck className="size-4 shrink-0" />
            <span>{t('logistics.board.carrier.searching')}</span>
          </div>
        )}
      </div>

      <ArrowRight className="hidden size-5 text-muted-foreground md:block" aria-hidden />

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <OrderPill
          primary
          title={item.orderNumber}
          route={formatRoute(item.pickupAddress, item.deliveryAddress)}
          cargo={formatCargo(item.cargoPallets, item.cargoWeightKg, locale)}
          price={formatMoney(item.clientPrice, item.currencyCode, locale)}
          href={detailHref}
        />
        <Plus className="size-4 shrink-0 text-muted-foreground" aria-label={t('logistics.board.loads.add')} />
        {loads.map((load: LoadPill) => (
          <OrderPill
            key={load.id}
            title={load.customerName || load.orderNumber}
            route={formatRoute(load.pickupAddress, load.deliveryAddress)}
            cargo={formatCargo(load.pallets, load.kg, locale)}
            price={formatMoney(load.price, item.currencyCode, locale)}
            pending={load.status === 'pending_approval'}
            href={detailHref}
          />
        ))}
        {Array.from({ length: pendingPlaceholders }).map((_, index) => (
          <span key={index} className="h-9 w-40 animate-pulse rounded-full bg-muted" aria-hidden />
        ))}
        {loads.length === 0 && pendingPlaceholders === 0 ? (
          <span className="text-xs text-muted-foreground">{t('logistics.board.loads.none')}</span>
        ) : null}
        {freeSpace ? (
          <span className={cn('ml-auto text-xs text-muted-foreground', overloaded && 'font-semibold text-status-error-text')}>
            {t('logistics.board.freeSpace', { value: formatCargo(freeSpace.pallets, freeSpace.kg, locale) || '—' })}
          </span>
        ) : null}
      </div>
    </li>
  )
}
