'use client'

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { canAcceptAdditionalLoad, demoAdditionalCargo, getRemainingCapacity, type Cargo, type OrderStatus, type Transport } from '../lib/dispatcher-data'

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
    <StatusBadge variant={status === 'confirmed' ? 'success' : status === 'pending' ? 'warning' : 'neutral'} dot>
      {t(`logistics.dispatcher.status.${status}`)}
    </StatusBadge>
  )
}

export function TransportDetails({ transport, onApproveCarrier, onAcceptAdditional }: {
  transport: Transport
  onApproveCarrier: () => void
  onAcceptAdditional: () => void
}) {
  const t = useT()
  const remaining = getRemainingCapacity(transport)
  const acceptedDemoLoad = transport.additionalLoads.some((load) => load.id === `${transport.id}-additional-demo`)
  const canAccept = !acceptedDemoLoad && canAcceptAdditionalLoad(transport, demoAdditionalCargo)
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
                <Button type="button" onClick={onApproveCarrier}>{t('logistics.dispatcher.approveCarrier')}</Button>
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
        {overloaded ? <Alert status="error" style="lighter"><AlertDescription>{t('logistics.dispatcher.overCapacity')}</AlertDescription></Alert> : null}
      </section>
      <section className="space-y-3 rounded-lg border border-border p-4">
        <SectionHeader title={t('logistics.dispatcher.additionalLoads')} count={transport.additionalLoads.length} />
        {transport.additionalLoads.length ? (
          <ul className="space-y-2 text-sm">
            {transport.additionalLoads.map((load) => <li key={load.id}><CargoSummary cargo={load.cargo} /></li>)}
          </ul>
        ) : <p className="text-sm text-muted-foreground">{t('logistics.dispatcher.noAdditionalLoads')}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <div className="space-y-1 text-sm">
            <p className="font-medium">{t('logistics.dispatcher.additionalCandidate')}</p>
            <CargoSummary cargo={demoAdditionalCargo} />
          </div>
          <Button type="button" variant="outline" disabled={!canAccept} onClick={onAcceptAdditional} aria-describedby="additional-load-hint">
            {t('logistics.dispatcher.acceptAdditional')}
          </Button>
        </div>
        <p id="additional-load-hint" className="text-sm text-muted-foreground">
          {t(acceptedDemoLoad ? 'logistics.dispatcher.additionalAlreadyAccepted' : 'logistics.dispatcher.additionalUnavailable')}
        </p>
      </section>
    </div>
  )
}
