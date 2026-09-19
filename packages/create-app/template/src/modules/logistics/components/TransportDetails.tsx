'use client'

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import type { useDispatcherList } from '../lib/useDispatcherList'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { canAcceptAdditionalLoad, getRemainingCapacity, type Cargo, type Offer, type OrderStatus, type Transport } from '../lib/dispatcher-data'

export function CargoSummary({ cargo }: { cargo: Cargo }) {
  const t = useT()
  return (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
      <span>{t('logistics.dispatcher.kg', { value: cargo.weightKg })}</span>
      <span>{t('logistics.dispatcher.pallets', { value: cargo.palletSpaces })}</span>
    </span>
  )
}

export function OrderStatusBadge({ status }: { status: OrderStatus | 'unassigned' }) {
  const t = useT()
  return (
    <StatusBadge variant={status === 'confirmed' ? 'success' : status === 'pending' ? 'warning' : status === 'rejected' ? 'error' : 'neutral'} dot>
      {t(`logistics.dispatcher.status.${status}`)}
    </StatusBadge>
  )
}

export function TransportDetails({ transport, candidates, saving, onApproveCarrier, onRejectCarrier, onAcceptAdditional }: {
  transport: Transport
  candidates: ReturnType<typeof useDispatcherList<Offer>>
  saving: boolean
  onApproveCarrier: () => void
  onRejectCarrier: () => void
  onAcceptAdditional: (offerId: string) => void
}) {
  const t = useT()
  const remaining = getRemainingCapacity(transport)
  const candidateColumns = React.useMemo<ColumnDef<Offer>[]>(() => [
    { accessorKey: 'reference', header: t('logistics.dispatcher.additionalCandidate') },
    { id: 'route', header: t('logistics.dispatcher.route'), accessorFn: (offer) => `${offer.origin} → ${offer.destination}` },
    { id: 'cargo', header: t('logistics.dispatcher.cargo'), cell: ({ row }) => <CargoSummary cargo={row.original.cargo} /> },
    { id: 'accept', header: t('logistics.dispatcher.status'), cell: ({ row }) => (
      <Button type="button" variant="outline" disabled={saving || !canAcceptAdditionalLoad(transport, row.original.cargo)
        || transport.additionalLoads.some((load) => load.offerId === row.original.id)}
        aria-label={`${t('logistics.dispatcher.acceptAdditional')}: ${row.original.reference}`}
        onClick={() => onAcceptAdditional(row.original.id)}>{t('logistics.dispatcher.acceptAdditional')}</Button>
    ) },
  ], [transport, saving, onAcceptAdditional, t])
  const overloaded = remaining !== null && (remaining.weightKg < 0 || remaining.palletSpaces < 0)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-4 rounded-lg border border-border p-4">
          <SectionHeader title={t('logistics.dispatcher.order1')} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-sm">{transport.order1.id}</span>
            <OrderStatusBadge status={transport.order1.status} />
          </div>
          <dl className="space-y-3 text-sm">
            <div><dt className="text-muted-foreground">{t('logistics.dispatcher.customer')}</dt><dd className="font-medium">{transport.customer}</dd></div>
            <div><dt className="text-muted-foreground">{t('logistics.dispatcher.route')}</dt><dd>{transport.origin} → {transport.destination}</dd></div>
            <div><dt className="text-muted-foreground">{t('logistics.dispatcher.dates')}</dt><dd>{transport.pickupDate} → {transport.deliveryDate}</dd></div>
            <div><dt className="text-muted-foreground">{t('logistics.dispatcher.cargo')}</dt><dd><CargoSummary cargo={transport.order1.cargo} /></dd></div>
          </dl>
        </section>
        <section className="space-y-4 rounded-lg border border-border p-4">
          <SectionHeader title={t('logistics.dispatcher.order2')} />
          {transport.order2 ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-sm">{transport.order2.id}</span>
                <OrderStatusBadge status={transport.order2.status} />
              </div>
              <dl className="space-y-3 text-sm">
                <div><dt className="text-muted-foreground">{t('logistics.dispatcher.carrier')}</dt><dd className="font-medium">{transport.order2.carrier}</dd></div>
                <div><dt className="text-muted-foreground">{t('logistics.dispatcher.vehicle')}</dt><dd>{transport.order2.vehicle.registration} · {t(transport.order2.vehicle.typeKey)}</dd></div>
                <div><dt className="text-muted-foreground">{t('logistics.dispatcher.capacity')}</dt><dd><CargoSummary cargo={transport.order2.vehicle.capacity} /></dd></div>
              </dl>
              {transport.order2.status === 'pending' ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={saving} onClick={onApproveCarrier}>{t('logistics.dispatcher.approveCarrier')}</Button>
                  <Button type="button" variant="destructive" disabled={saving} onClick={onRejectCarrier}>{t('logistics.dispatcher.rejectCarrier')}</Button>
                </div>
              ) : null}
            </>
          ) : <p className="text-sm text-muted-foreground">{t('logistics.dispatcher.noCarrier')}</p>}
        </section>
      </div>
      <section className="space-y-3 rounded-lg border border-border bg-muted/30 p-4" data-testid="remaining-capacity">
        <SectionHeader title={t('logistics.dispatcher.remaining')} />
        {remaining ? <div className="text-lg font-semibold"><CargoSummary cargo={remaining} /></div> : (
          <p className="text-sm text-muted-foreground">{t('logistics.dispatcher.unknownCapacity')}</p>
        )}
        {overloaded ? <Alert status="error"><AlertDescription>{t('logistics.dispatcher.overCapacity')}</AlertDescription></Alert> : null}
      </section>
      <section className="space-y-3 rounded-lg border border-border p-4">
        <SectionHeader title={t('logistics.dispatcher.additionalLoads')} count={transport.additionalLoads.length} />
        {transport.additionalLoads.length ? (
          <ul className="space-y-2 text-sm">
            {transport.additionalLoads.map((load) => <li key={load.id} className="flex flex-wrap items-center gap-3">
              <span className="font-medium">{t('logistics.dispatcher.additionalOrder', { number: load.orderNumber })}</span>
              <CargoSummary cargo={load.cargo} /><OrderStatusBadge status={load.status} />
            </li>)}
          </ul>
        ) : <p className="text-sm text-muted-foreground">{t('logistics.dispatcher.noAdditionalLoads')}</p>}
        {candidates.failed ? <ErrorMessage label={t('logistics.dispatcher.loadFailed')} action={<Button type="button" variant="outline" onClick={candidates.reload}>{t('logistics.dispatcher.retry')}</Button>} /> : null}
        <DataTable columns={candidateColumns} data={candidates.items} isLoading={candidates.loading}
          pagination={candidates.pagination} exporter={false}
          searchValue={candidates.search} onSearchChange={candidates.changeSearch} searchPlaceholder={t('logistics.dispatcher.searchOffers')}
          emptyState={<EmptyState title={t('logistics.dispatcher.noCandidates')} />} />
        <p className="text-sm text-muted-foreground">{t('logistics.dispatcher.additionalUnavailable')}</p>
      </section>
    </div>
  )
}
