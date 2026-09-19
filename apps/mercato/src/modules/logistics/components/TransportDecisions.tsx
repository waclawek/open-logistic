'use client'

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { extensionPoints } from '../extension-points'
import type { Offer } from '../lib/dispatcher-data'
import { useDispatcherList } from '../lib/useDispatcherList'
import type { TransportDetail } from '../types'
import { CargoSummary } from './TransportDetails'

type Decision = { action: 'approve_carrier' | 'reject_carrier' | 'accept_load' | 'reject_load'; offerId?: string; orderId?: string }

export function TransportDecisions({ transport, onChanged, onReload }: {
  transport: TransportDetail
  onChanged: (value: TransportDetail) => void
  onReload: () => void
}) {
  const t = useT()
  const locale = useLocale()
  const scopeVersion = useOrganizationScopeVersion()
  const scopeRef = React.useRef(scopeVersion)
  scopeRef.current = scopeVersion
  const mountedRef = React.useRef(true)
  React.useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  const candidates = useDispatcherList<Offer>('offers', true)
  const [saving, setSaving] = React.useState(false)
  const savingRef = React.useRef(false)
  const [failed, setFailed] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId: 'logistics.dispatcher' })
  const carrierApproved = transport.order2?.status === 'approved' || transport.order2?.status === 'confirmed'
  const fits = (pallets: unknown, weight: unknown) => transport.order1.status === 'confirmed' && carrierApproved
    && typeof pallets === 'number' && Number.isFinite(pallets) && typeof weight === 'number' && Number.isFinite(weight)
    && pallets >= 0 && weight >= 0 && (pallets > 0 || weight > 0) && transport.freeSpace?.pallets != null && transport.freeSpace.kg != null
    && pallets <= transport.freeSpace.pallets && weight <= transport.freeSpace.kg

  const decide = async (decision: Decision | { action: 'reject' }, offer?: Offer) => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setFailed(false)
    setSaved(false)
    const decisionScope = scopeVersion
    const isCurrent = () => mountedRef.current && scopeRef.current === decisionScope
    const rejectingOffer = decision.action === 'reject'
    const payload = rejectingOffer ? decision : { ...decision, transportVersion: transport.transportVersion }
    const record = rejectingOffer ? offer : transport.order1
    if (!record) { savingRef.current = false; setSaving(false); return }
    try {
      await runMutation({
        context: {
          formId: 'logistics.dispatcher',
          entityId: rejectingOffer ? 'logistics:logistics_offer' : 'sales:sales_order',
          resourceKind: rejectingOffer ? 'logistics.offer' : 'sales.order',
          resourceId: record.id,
          retryLastMutation,
        },
        mutationPayload: payload,
        operation: async () => {
          if (!isCurrent()) return
          const response = await withScopedApiRequestHeaders(buildOptimisticLockHeader(rejectingOffer ? record.updatedAt : transport.updatedAt), () =>
            apiCallOrThrow<{ item: TransportDetail | Offer }>(`/api/logistics/${rejectingOffer ? 'offers' : 'transports'}/${record.id}/decision`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            }))
          if (!isCurrent()) return
          const item = response.result?.item
          if (item && 'order1' in item) onChanged(item)
          candidates.reload()
          setSaved(true)
        },
      })
    } catch (error) {
      if (!isCurrent()) return
      if (surfaceRecordConflict(error, t)) onReload()
      else setFailed(true)
      candidates.reload()
    } finally {
      savingRef.current = false
      if (isCurrent()) setSaving(false)
    }
  }

  const columns: ColumnDef<Offer>[] = [
    { accessorKey: 'reference', header: t('logistics.dispatcher.additionalCandidate') },
    { accessorKey: 'customer', header: t('logistics.dispatcher.customer') },
    { id: 'route', header: t('logistics.dispatcher.route'), accessorFn: (offer) => `${offer.origin} → ${offer.destination}` },
    { id: 'dates', header: t('logistics.dispatcher.dates'), cell: ({ row }) => `${row.original.pickupDate} → ${row.original.deliveryDate}` },
    { id: 'cargo', header: t('logistics.dispatcher.cargo'), cell: ({ row }) => <CargoSummary cargo={row.original.cargo} /> },
    { id: 'price', header: t('logistics.dispatcher.price'), cell: ({ row }) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(row.original.priceEur) },
    { id: 'decision', header: t('logistics.dispatcher.status'), cell: ({ row }) => <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={saving || !fits(row.original.cargo.palletSpaces, row.original.cargo.weightKg)}
        aria-label={`${t('logistics.dispatcher.acceptAdditional')}: ${row.original.reference}`}
        onClick={() => void decide({ action: 'accept_load', offerId: row.original.id })}>{t('logistics.dispatcher.acceptAdditional')}</Button>
      <Button type="button" variant="destructive" disabled={saving}
        aria-label={`${t('logistics.dispatcher.rejectOffer')}: ${row.original.reference}`}
        onClick={() => void decide({ action: 'reject' }, row.original)}>{t('logistics.dispatcher.rejectOffer')}</Button>
    </div> },
  ]

  return <section className="space-y-4 rounded-lg border border-border bg-card p-4 md:p-6">
    <SectionHeader title={t('logistics.transport.decisions')} />
    {transport.order2?.status === 'pending_approval' ? <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={saving} onClick={() => void decide({ action: 'approve_carrier' })}>{t('logistics.dispatcher.approveCarrier')}</Button>
      <Button type="button" variant="destructive" disabled={saving} onClick={() => void decide({ action: 'reject_carrier' })}>{t('logistics.dispatcher.rejectCarrier')}</Button>
    </div> : null}
    {transport.additionalLoads.filter((order) => order.status === 'pending_approval').map((order) => <div key={order.id} className="flex flex-wrap items-center gap-3">
      <span className="text-sm font-medium">{order.orderNumber}</span>
      <Button type="button" variant="outline" disabled={saving || !fits(order.fields.cargo_pallets, order.fields.cargo_weight_kg)}
        aria-label={`${t('logistics.dispatcher.acceptAdditional')}: ${order.orderNumber}`}
        onClick={() => void decide({ action: 'accept_load', orderId: order.id })}>{t('logistics.dispatcher.acceptAdditional')}</Button>
      <Button type="button" variant="destructive" disabled={saving} aria-label={`${t('logistics.transport.rejectLoad')}: ${order.orderNumber}`}
        onClick={() => void decide({ action: 'reject_load', orderId: order.id })}>{t('logistics.transport.rejectLoad')}</Button>
    </div>)}
    {saving ? <LoadingMessage label={t('logistics.dispatcher.saving')} /> : null}
    {failed ? <ErrorMessage label={t('logistics.dispatcher.saveFailed')} /> : null}
    {saved ? <p role="status" className="text-sm text-status-success-text">{t('logistics.dispatcher.saved')}</p> : null}
    {candidates.failed ? <ErrorMessage label={t('logistics.dispatcher.loadFailed')} action={<Button type="button" variant="outline" onClick={candidates.reload}>{t('logistics.dispatcher.retry')}</Button>} /> : null}
    <DataTable columns={columns} data={candidates.items} isLoading={candidates.loading} pagination={candidates.pagination}
      extensionTableId={extensionPoints.hosts.offersTable.tableId} exporter={false}
      searchValue={candidates.search} onSearchChange={candidates.changeSearch} searchPlaceholder={t('logistics.dispatcher.searchOffers')}
      emptyState={<EmptyState title={t('logistics.dispatcher.noCandidates')} />} />
    <p className="text-sm text-muted-foreground">{t('logistics.dispatcher.additionalUnavailable')}</p>
  </section>
}
