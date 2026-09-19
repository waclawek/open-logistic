'use client'

import * as React from 'react'
import Link from 'next/link'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Inbox, Truck } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { PageHeader } from '@open-mercato/ui/backend/Page'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import { extensionPoints } from '../extension-points'
import { getRemainingCapacity, type Offer, type Transport } from '../lib/dispatcher-data'
import { useDispatcherList } from '../lib/useDispatcherList'
import { CargoSummary, OrderStatusBadge, TransportDetails } from './TransportDetails'

export function DispatcherPanelHeader() {
  const t = useT()
  return <PageHeader title={t('logistics.dispatcher.title')} description={t('logistics.dispatcher.description')} />
}

export function DispatcherPanel({ initialTab = 'inbox' }: { initialTab?: 'inbox' | 'transports' }) {
  const t = useT()
  const locale = useLocale()
  const scopeVersion = useOrganizationScopeVersion()
  const scopeRef = React.useRef(scopeVersion)
  scopeRef.current = scopeVersion
  const [tab, setTab] = React.useState(initialTab)
  React.useEffect(() => { setTab(initialTab) }, [initialTab])
  const offers = useDispatcherList<Offer>('offers')
  const transports = useDispatcherList<Transport>('transports')
  const [selection, setSelection] = React.useState<{ kind: 'offer' | 'transport'; id: string } | null>(null)
  const selectionRef = React.useRef(selection)
  selectionRef.current = selection
  const [feedback, setFeedback] = React.useState('')
  const [mutationFailed, setMutationFailed] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [savingRecordId, setSavingRecordId] = React.useState<string | null>(null)
  const [handoffTransportId, setHandoffTransportId] = React.useState<string | null>(null)
  React.useEffect(() => { setSelection(null); setFeedback(''); setMutationFailed(false); setHandoffTransportId(null) }, [scopeVersion, initialTab])
  const savingRef = React.useRef(false)
  const { runMutation, retryLastMutation } = useGuardedMutation({ contextId: 'logistics.dispatcher' })
  const candidates = useDispatcherList<Offer>('offers', true, selection?.kind === 'transport')
  const detailTrigger = React.useRef<HTMLElement | null>(null)
  const selectedOffer = selection?.kind === 'offer' ? offers.items.find((offer) => offer.id === selection.id) : undefined
  const selectedTransport = selection?.kind === 'transport' ? transports.items.find((transport) => transport.id === selection.id) : undefined
  const currency = React.useMemo(() => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }), [locale])

  const openDetails = React.useCallback((kind: 'offer' | 'transport', id: string) => {
    detailTrigger.current = document.getElementById(`logistics-${kind}-${id}`)
    setFeedback('')
    setMutationFailed(false)
    setSelection({ kind, id })
  }, [])

  const decide = async (action: 'approve_carrier' | 'reject_carrier' | 'accept_load' | 'reject', offerId?: string) => {
    const record = action === 'reject' ? selectedOffer : selectedTransport
    if (!record || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setSavingRecordId(record.id)
    setFeedback('')
    setMutationFailed(false)
    const resource = action === 'reject' ? 'offers' : 'transports'
    const decisionScope = scopeVersion
    const sameSelection = () => selectionRef.current?.id === record.id && selectionRef.current?.kind === (resource === 'offers' ? 'offer' : 'transport')
    const payload = { action, ...(offerId ? { offerId } : {}) }
    try {
      await runMutation({
        context: {
          formId: 'logistics.dispatcher',
          entityId: `logistics:logistics_${resource === 'offers' ? 'offer' : 'transport'}`,
          resourceKind: `logistics.${resource === 'offers' ? 'offer' : 'transport'}`,
          resourceId: record.id,
          retryLastMutation,
        },
        mutationPayload: payload,
        operation: async () => {
          if (scopeRef.current !== decisionScope) return
          const response = await withScopedApiRequestHeaders(buildOptimisticLockHeader(record.updatedAt), () =>
            apiCallOrThrow<{ item: Offer | Transport }>(`/api/logistics/${resource}/${record.id}/decision`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            })).catch((error: unknown) => {
              if (scopeRef.current !== decisionScope) return null
              throw error
            })
          if (!response || scopeRef.current !== decisionScope) return
          if (response.result?.item) {
            if (resource === 'offers') offers.replaceItem(response.result.item as Offer)
            else transports.replaceItem(response.result.item as Transport)
          }
          offers.reload()
          transports.reload()
          candidates.reload()
          if (sameSelection()) {
            if (action === 'approve_carrier' && response.result?.item) {
              const updated = response.result.item as Transport
              if (updated.order1.status === 'confirmed' && updated.order2?.status === 'confirmed') {
                try {
                  await withScopedApiRequestHeaders({}, () =>
                    apiCallOrThrow<{ run: { id: string }; created: boolean }>(
                      '/api/logistics/transport-runs',
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          action: 'start-from-dispatcher-transport',
                          transportId: updated.id,
                        }),
                      },
                    ),
                  )
                  setFeedback(t('logistics.dispatcher.handoffStarted'))
                  setHandoffTransportId(updated.id)
                  return
                } catch {
                  // Decision already saved — handoff can be retried from the monitoring inbox.
                }
              }
            }
            setFeedback(t('logistics.dispatcher.saved'))
          }
        },
      })
    } catch (error) {
      if (scopeRef.current !== decisionScope) return
      if (!surfaceRecordConflict(error, t) && sameSelection()) setMutationFailed(true)
      offers.reload()
      transports.reload()
      candidates.reload()
    } finally {
      savingRef.current = false
      setSaving(false)
      setSavingRecordId(null)
    }
  }

  const offerColumns = React.useMemo<ColumnDef<Offer>[]>(() => [
    { accessorKey: 'reference', header: t('logistics.dispatcher.open'), cell: ({ row }) => (
      <Button id={`logistics-offer-${row.original.id}`} type="button" variant="link" className="px-0" aria-label={`${t('logistics.dispatcher.open')}: ${row.original.reference}`} onClick={() => openDetails('offer', row.original.id)}>{row.original.reference}</Button>
    ) },
    { accessorKey: 'customer', header: t('logistics.dispatcher.customer') },
    { id: 'route', header: t('logistics.dispatcher.route'), accessorFn: (offer) => `${offer.origin} → ${offer.destination}` },
    { id: 'dates', header: t('logistics.dispatcher.dates'), cell: ({ row }) => <span className="whitespace-nowrap text-sm">{row.original.pickupDate}<br />{row.original.deliveryDate}</span> },
    { id: 'cargo', header: t('logistics.dispatcher.cargo'), cell: ({ row }) => <CargoSummary cargo={row.original.cargo} /> },
    { accessorKey: 'priceEur', header: t('logistics.dispatcher.price'), cell: ({ row }) => <span className="whitespace-nowrap font-medium tabular-nums">{currency.format(row.original.priceEur)}</span> },
    { accessorKey: 'source', header: t('logistics.dispatcher.source'), cell: ({ row }) => t(`logistics.dispatcher.source.${row.original.source}`) },
    { accessorKey: 'status', header: t('logistics.dispatcher.status'), cell: ({ row }) => <StatusBadge variant={row.original.status === 'rejected' ? 'error' : row.original.status === 'accepted' ? 'success' : row.original.status === 'new' ? 'info' : 'warning'} dot>{t(`logistics.dispatcher.status.${row.original.status}`)}</StatusBadge> },
  ], [currency, openDetails, t])

  const transportColumns = React.useMemo<ColumnDef<Transport>[]>(() => [
    { accessorKey: 'reference', header: t('logistics.dispatcher.order'), cell: ({ row }) => (
      <Button id={`logistics-transport-${row.original.id}`} type="button" variant="link" className="px-0" aria-label={`${t('logistics.dispatcher.open')}: ${row.original.reference}`} onClick={() => openDetails('transport', row.original.id)}>{row.original.reference}</Button>
    ) },
    { accessorKey: 'customer', header: t('logistics.dispatcher.customer') },
    { id: 'route', header: t('logistics.dispatcher.route'), accessorFn: (transport) => `${transport.origin} → ${transport.destination}` },
    { id: 'order1', header: t('logistics.dispatcher.order1'), cell: ({ row }) => <div className="space-y-1"><p className="text-xs text-muted-foreground">{row.original.order1.id}</p><OrderStatusBadge status={row.original.order1.status} /></div> },
    { id: 'order2', header: t('logistics.dispatcher.order2'), cell: ({ row }) => <div className="space-y-1"><p className="text-xs text-muted-foreground">{row.original.order2?.carrier}</p><OrderStatusBadge status={row.original.order2?.status ?? 'unassigned'} /></div> },
    { id: 'remaining', header: t('logistics.dispatcher.remaining'), cell: ({ row }) => {
      const remaining = getRemainingCapacity(row.original)
      return remaining ? <CargoSummary cargo={remaining} /> : <span className="text-sm text-muted-foreground">{t('logistics.dispatcher.status.unassigned')}</span>
    } },
  ], [openDetails, t])

  const emptyState = <EmptyState title={t('logistics.dispatcher.emptyTitle')} description={t('logistics.dispatcher.emptyDescription')} />

  return (
    <>
        <Tabs value={tab} onValueChange={(value) => { if (value === 'inbox' || value === 'transports') setTab(value) }} variant="underline">
          <TabsList>
            <TabsTrigger value="inbox" leading={<Inbox className="size-4" aria-hidden="true" />} count={<span aria-hidden="true">{offers.total}</span>}>{t('logistics.dispatcher.inbox')}</TabsTrigger>
            <TabsTrigger value="transports" leading={<Truck className="size-4" aria-hidden="true" />} count={<span aria-hidden="true">{transports.total}</span>}>{t('logistics.dispatcher.transports')}</TabsTrigger>
          </TabsList>
          <TabsContent value="inbox" className="pt-4">
            {offers.failed ? <ErrorMessage label={t('logistics.dispatcher.loadFailed')} action={<Button type="button" variant="outline" onClick={offers.reload}>{t('logistics.dispatcher.retry')}</Button>} /> : null}
            <DataTable columns={offerColumns} data={offers.items} isLoading={offers.loading} pagination={offers.pagination} title={t('logistics.dispatcher.offersTitle')}
              extensionTableId={extensionPoints.hosts.offersTable.tableId}
              searchValue={offers.search} onSearchChange={offers.changeSearch} searchPlaceholder={t('logistics.dispatcher.searchOffers')}
              emptyState={emptyState} exporter={false}
              rowActions={(offer) => <RowActions items={[{ id: 'open', label: t('logistics.dispatcher.open'), onSelect: () => openDetails('offer', offer.id) }]} />} />
          </TabsContent>
          <TabsContent value="transports" className="pt-4">
            {transports.failed ? <ErrorMessage label={t('logistics.dispatcher.loadFailed')} action={<Button type="button" variant="outline" onClick={transports.reload}>{t('logistics.dispatcher.retry')}</Button>} /> : null}
            <DataTable columns={transportColumns} data={transports.items} isLoading={transports.loading} pagination={transports.pagination} title={t('logistics.dispatcher.transportsTitle')}
              extensionTableId={extensionPoints.hosts.transportsTable.tableId}
              searchValue={transports.search} onSearchChange={transports.changeSearch} searchPlaceholder={t('logistics.dispatcher.searchTransports')}
              emptyState={emptyState} exporter={false}
              rowActions={(transport) => <RowActions items={[{ id: 'open', label: t('logistics.dispatcher.open'), onSelect: () => openDetails('transport', transport.id) }]} />} />
          </TabsContent>
        </Tabs>
        <Dialog open={Boolean(selectedOffer || selectedTransport)} onOpenChange={(open) => { if (!open) setSelection(null) }}>
          <DialogContent size="xl" className="max-h-dvh overflow-y-auto" onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (detailTrigger.current?.isConnected) detailTrigger.current.focus()
          }} onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              if (selectedTransport?.order2?.status === 'pending') void decide('approve_carrier')
            }
          }}>
            <DialogHeader>
              <DialogTitle>{t(selectedOffer ? 'logistics.dispatcher.offerDetails' : 'logistics.dispatcher.transportDetails')} · {selectedOffer?.reference ?? selectedTransport?.reference}</DialogTitle>
              <DialogDescription>{selectedOffer ? t('logistics.dispatcher.offerNote') : t('logistics.dispatcher.transportNote')}</DialogDescription>
            </DialogHeader>
            {selectedOffer ? (
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">{t('logistics.dispatcher.status')}</dt><dd>{t(`logistics.dispatcher.status.${selectedOffer.status}`)}</dd></div>
                <div><dt className="text-muted-foreground">{t('logistics.dispatcher.customer')}</dt><dd className="font-medium">{selectedOffer.customer}</dd></div>
                <div><dt className="text-muted-foreground">{t('logistics.dispatcher.route')}</dt><dd>{selectedOffer.origin} → {selectedOffer.destination}</dd></div>
                <div><dt className="text-muted-foreground">{t('logistics.dispatcher.dates')}</dt><dd>{selectedOffer.pickupDate} → {selectedOffer.deliveryDate}</dd></div>
                <div><dt className="text-muted-foreground">{t('logistics.dispatcher.cargo')}</dt><dd><CargoSummary cargo={selectedOffer.cargo} /></dd></div>
                <div><dt className="text-muted-foreground">{t('logistics.dispatcher.price')}</dt><dd className="font-semibold">{currency.format(selectedOffer.priceEur)}</dd></div>
                <div><dt className="text-muted-foreground">{t('logistics.dispatcher.source')}</dt><dd>{t(`logistics.dispatcher.source.${selectedOffer.source}`)}</dd></div>
              </dl>
            ) : null}
            {selectedTransport ? <TransportDetails transport={selectedTransport} candidates={candidates} saving={saving}
              onApproveCarrier={() => void decide('approve_carrier')} onRejectCarrier={() => void decide('reject_carrier')}
              onAcceptAdditional={(offerId) => void decide('accept_load', offerId)} /> : null}
            {saving && selection?.id === savingRecordId ? <LoadingMessage label={t('logistics.dispatcher.saving')} /> : null}
            {mutationFailed ? <ErrorMessage label={t('logistics.dispatcher.saveFailed')} /> : null}
            {selection && feedback ? <p role="status" className="text-sm text-status-success-text">{feedback}</p> : null}
            {selectedTransport &&
            selectedTransport.order1.status === 'confirmed' &&
            selectedTransport.order2?.status === 'confirmed' ? (
              <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                <p className="mb-2 font-medium">{t('logistics.dispatcher.handoffReady')}</p>
                <LinkButton asChild>
                  <Link href="/backend/logistics/proposals-disruptions">
                    {t('logistics.dispatcher.handoffToMonitoring')}
                  </Link>
                </LinkButton>
              </div>
            ) : null}
            <DialogFooter>
              {selectedOffer && (selectedOffer.status === 'new' || selectedOffer.status === 'review') ? <Button type="button" variant="destructive" disabled={saving} onClick={() => void decide('reject')}>{t('logistics.dispatcher.rejectOffer')}</Button> : null}
              {handoffTransportId && selection?.id === handoffTransportId ? (
                <LinkButton asChild>
                  <Link href="/backend/logistics/proposals-disruptions">
                    {t('logistics.dispatcher.handoffToMonitoring')}
                  </Link>
                </LinkButton>
              ) : null}
              <Button type="button" variant="outline" onClick={() => setSelection(null)}>{t('logistics.dispatcher.close')}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
    </>
  )
}
