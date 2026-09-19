'use client'

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Inbox, RotateCcw, Truck } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { extensionPoints } from '../extension-points'
import { acceptDemoAdditionalLoad, approveDemoCarrier, canAcceptAdditionalLoad, demoAdditionalCargo, demoOffers, demoTransports, getRemainingCapacity, type Offer, type Transport } from '../lib/dispatcher-data'
import { CargoSummary, OrderStatusBadge, TransportDetails } from './TransportDetails'

export function DispatcherPanel() {
  const t = useT()
  const locale = useLocale()
  const [tab, setTab] = React.useState('inbox')
  const [offersSearch, setOffersSearch] = React.useState('')
  const [transportsSearch, setTransportsSearch] = React.useState('')
  const [transports, setTransports] = React.useState(demoTransports)
  const [selection, setSelection] = React.useState<{ kind: 'offer' | 'transport'; id: string } | null>(null)
  const [feedback, setFeedback] = React.useState('')
  const detailTrigger = React.useRef<HTMLElement | null>(null)
  const selectedOffer = selection?.kind === 'offer' ? demoOffers.find((offer) => offer.id === selection.id) : undefined
  const selectedTransport = selection?.kind === 'transport' ? transports.find((transport) => transport.id === selection.id) : undefined
  const currency = React.useMemo(() => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }), [locale])

  const openDetails = React.useCallback((kind: 'offer' | 'transport', id: string) => {
    detailTrigger.current = document.getElementById(`logistics-${kind}-${id}`)
    setFeedback('')
    setSelection({ kind, id })
  }, [])

  const approveCarrier = () => {
    if (!selectedTransport || selectedTransport.order2?.status !== 'pending') return
    setTransports((current) => approveDemoCarrier(current, selectedTransport.id))
    setFeedback(t('logistics.dispatcher.carrierApproved'))
  }

  const acceptAdditional = () => {
    if (!selectedTransport || !canAcceptAdditionalLoad(selectedTransport, demoAdditionalCargo)
      || selectedTransport.additionalLoads.some((load) => load.id === `${selectedTransport.id}-additional-demo`)) return
    setTransports((current) => acceptDemoAdditionalLoad(current, selectedTransport.id))
    setFeedback(t('logistics.dispatcher.additionalAccepted'))
  }

  const offerColumns = React.useMemo<ColumnDef<Offer>[]>(() => [
    { accessorKey: 'id', header: t('logistics.dispatcher.open'), cell: ({ row }) => (
      <Button id={`logistics-offer-${row.original.id}`} type="button" variant="link" className="px-0" aria-label={`${t('logistics.dispatcher.open')}: ${row.original.id}`} onClick={() => openDetails('offer', row.original.id)}>{row.original.id}</Button>
    ) },
    { accessorKey: 'customer', header: t('logistics.dispatcher.customer') },
    { id: 'route', header: t('logistics.dispatcher.route'), accessorFn: (offer) => `${offer.origin} → ${offer.destination}` },
    { id: 'dates', header: t('logistics.dispatcher.dates'), cell: ({ row }) => <span className="whitespace-nowrap text-sm">{row.original.pickupDate}<br />{row.original.deliveryDate}</span> },
    { id: 'cargo', header: t('logistics.dispatcher.cargo'), cell: ({ row }) => <CargoSummary cargo={row.original.cargo} /> },
    { accessorKey: 'priceEur', header: t('logistics.dispatcher.price'), cell: ({ row }) => <span className="whitespace-nowrap font-medium tabular-nums">{currency.format(row.original.priceEur)}</span> },
    { accessorKey: 'source', header: t('logistics.dispatcher.source'), cell: ({ row }) => t(`logistics.dispatcher.source.${row.original.source}`) },
    { accessorKey: 'status', header: t('logistics.dispatcher.status'), cell: ({ row }) => <StatusBadge variant={row.original.status === 'new' ? 'info' : 'warning'} dot>{t(`logistics.dispatcher.status.${row.original.status}`)}</StatusBadge> },
  ], [currency, openDetails, t])

  const transportColumns = React.useMemo<ColumnDef<Transport>[]>(() => [
    { accessorKey: 'id', header: t('logistics.dispatcher.order'), cell: ({ row }) => (
      <Button id={`logistics-transport-${row.original.id}`} type="button" variant="link" className="px-0" aria-label={`${t('logistics.dispatcher.open')}: ${row.original.id}`} onClick={() => openDetails('transport', row.original.id)}>{row.original.id}</Button>
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

  const visibleOffers = demoOffers.filter((offer) => `${offer.id} ${offer.customer} ${offer.origin} ${offer.destination}`.toLocaleLowerCase(locale).includes(offersSearch.trim().toLocaleLowerCase(locale)))
  const visibleTransports = transports.filter((transport) => `${transport.id} ${transport.customer} ${transport.origin} ${transport.destination} ${transport.order1.id} ${transport.order2?.id ?? ''} ${transport.order2?.carrier ?? ''}`.toLocaleLowerCase(locale).includes(transportsSearch.trim().toLocaleLowerCase(locale)))
  const emptyState = <EmptyState title={t('logistics.dispatcher.emptyTitle')} description={t('logistics.dispatcher.emptyDescription')} />

  return (
    <Page data-testid="logistics-page">
      <PageHeader title={t('logistics.dispatcher.title')} description={t('logistics.dispatcher.description')} actions={(
        <Button type="button" variant="outline" onClick={() => {
          setTransports(demoTransports)
          setSelection(null)
          setOffersSearch('')
          setTransportsSearch('')
          setFeedback(t('logistics.dispatcher.resetDone'))
        }}><RotateCcw className="size-4" aria-hidden="true" />{t('logistics.dispatcher.reset')}</Button>
      )} />
      <PageBody>
        <Alert status="information" style="lighter">
          <AlertTitle>{t('logistics.dispatcher.demoTitle')}</AlertTitle>
          <AlertDescription>{t('logistics.dispatcher.demoDescription')}</AlertDescription>
        </Alert>
        {!selection && feedback ? <p role="status" className="text-sm text-status-success-text">{feedback}</p> : null}
        <Tabs value={tab} onValueChange={setTab} variant="underline">
          <TabsList>
            <TabsTrigger value="inbox" leading={<Inbox className="size-4" aria-hidden="true" />} count={<span aria-hidden="true">{demoOffers.length}</span>}>{t('logistics.dispatcher.inbox')}</TabsTrigger>
            <TabsTrigger value="transports" leading={<Truck className="size-4" aria-hidden="true" />} count={<span aria-hidden="true">{transports.length}</span>}>{t('logistics.dispatcher.transports')}</TabsTrigger>
          </TabsList>
          <TabsContent value="inbox" className="pt-4">
            <DataTable columns={offerColumns} data={visibleOffers} title={t('logistics.dispatcher.offersTitle')}
              extensionTableId={extensionPoints.hosts.offersTable.tableId}
              searchValue={offersSearch} onSearchChange={setOffersSearch} searchPlaceholder={t('logistics.dispatcher.searchOffers')}
              emptyState={emptyState} exporter={false}
              rowActions={(offer) => <RowActions items={[{ id: 'open', label: t('logistics.dispatcher.open'), onSelect: () => openDetails('offer', offer.id) }]} />} />
          </TabsContent>
          <TabsContent value="transports" className="pt-4">
            <DataTable columns={transportColumns} data={visibleTransports} title={t('logistics.dispatcher.transportsTitle')}
              extensionTableId={extensionPoints.hosts.transportsTable.tableId}
              searchValue={transportsSearch} onSearchChange={setTransportsSearch} searchPlaceholder={t('logistics.dispatcher.searchTransports')}
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
              if (selectedTransport?.order2?.status === 'pending') approveCarrier()
              else acceptAdditional()
            }
          }}>
            <DialogHeader>
              <DialogTitle>{t(selectedOffer ? 'logistics.dispatcher.offerDetails' : 'logistics.dispatcher.transportDetails')} · {selection?.id}</DialogTitle>
              <DialogDescription>{selectedOffer ? t('logistics.dispatcher.offerNote') : t('logistics.dispatcher.demoDescription')}</DialogDescription>
            </DialogHeader>
            {selectedOffer ? (
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">{t('logistics.dispatcher.customer')}</dt><dd className="font-medium">{selectedOffer.customer}</dd></div>
                <div><dt className="text-muted-foreground">{t('logistics.dispatcher.route')}</dt><dd>{selectedOffer.origin} → {selectedOffer.destination}</dd></div>
                <div><dt className="text-muted-foreground">{t('logistics.dispatcher.dates')}</dt><dd>{selectedOffer.pickupDate} → {selectedOffer.deliveryDate}</dd></div>
                <div><dt className="text-muted-foreground">{t('logistics.dispatcher.cargo')}</dt><dd><CargoSummary cargo={selectedOffer.cargo} /></dd></div>
                <div><dt className="text-muted-foreground">{t('logistics.dispatcher.price')}</dt><dd className="font-semibold">{currency.format(selectedOffer.priceEur)}</dd></div>
                <div><dt className="text-muted-foreground">{t('logistics.dispatcher.source')}</dt><dd>{t(`logistics.dispatcher.source.${selectedOffer.source}`)}</dd></div>
              </dl>
            ) : null}
            {selectedTransport ? <TransportDetails transport={selectedTransport} onApproveCarrier={approveCarrier} onAcceptAdditional={acceptAdditional} /> : null}
            {selection && feedback ? <p role="status" className="text-sm text-status-success-text">{feedback}</p> : null}
            <DialogFooter><Button type="button" variant="outline" onClick={() => setSelection(null)}>{t('logistics.dispatcher.close')}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </PageBody>
    </Page>
  )
}
