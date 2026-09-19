'use client'

import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { TransportJob } from '../lib/backhaul'
import type { PriceJobResult, CarrierProfile, VehicleProfile } from '../lib/pricing'
import { AgentPanel, DispatchBadge, RECOMMENDATION_LABELS, StatTile, cityOf, dateShort, pln, updateDispatch } from './shared'

type JobRow = TransportJob & { pricing: PriceJobResult }
type Payload = { items: JobRow[]; carriers: CarrierProfile[]; vehicles: VehicleProfile[] }

export function TransportJobsBoard() {
  const [data, setData] = React.useState<Payload | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [openId, setOpenId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    const call = await apiCall<Payload>('/api/logistics/transport-jobs')
    if (call.ok && call.result) setData(call.result)
    else flash('Nie udało się wczytać zleceń.', 'error')
    setLoading(false)
  }, [])

  React.useEffect(() => { void load() }, [load])

  const approve = async (job: JobRow) => {
    const rec = job.pricing.recommendation
    if (rec !== 'own_fleet' && rec !== 'subcontractor') {
      flash('Ta rekomendacja wymaga decyzji dyspozytora — ustaw ręcznie w zamówieniu.', 'info')
      return
    }
    setBusyId(job.id)
    const fields: Record<string, unknown> =
      rec === 'own_fleet'
        ? {
            dispatch_mode: 'own_fleet',
            assigned_vehicle: job.pricing.ownFleet.availableVehicle?.plate ?? null,
            assigned_carrier: null,
            carrier_cost: job.pricing.ownFleet.cost,
            margin_pct: job.pricing.ownFleet.marginPct,
            dispatch_note: `[Agent] ${job.pricing.rationale}`,
          }
        : {
            dispatch_mode: 'subcontractor',
            assigned_vehicle: null,
            assigned_carrier: job.pricing.bestCarrier?.name ?? null,
            carrier_cost: job.pricing.bestCarrier?.cost ?? null,
            margin_pct: job.pricing.bestCarrier?.marginPct ?? null,
            dispatch_note: `[Agent] ${job.pricing.rationale}`,
          }
    const result = await updateDispatch(job.id, fields)
    setBusyId(null)
    if (result.ok) {
      flash(`Zlecenie ${job.orderNumber} przypisane.`, 'success')
      await load()
    } else {
      flash(`Nie udało się zapisać: ${result.error}`, 'error')
    }
  }

  const items = data?.items ?? []
  const unassigned = items.filter((j) => j.dispatchMode === 'unassigned')
  const margins = items.map((j) => j.marginPct ?? j.pricing.ownFleet.marginPct).filter((m): m is number => m != null)
  const avgMargin = margins.length ? Math.round((margins.reduce((a, b) => a + b, 0) / margins.length) * 10) / 10 : null
  const revenue = items.reduce((sum, j) => sum + (j.clientPrice ?? 0), 0)
  const freeVehicles = (data?.vehicles ?? []).filter((v) => v.status === 'available').length

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Zlecenia" value={items.length} hint={`${unassigned.length} do przypisania`} />
        <StatTile label="Przychód w kolejce" value={pln.format(revenue)} />
        <StatTile label="Średnia marża" value={avgMargin != null ? `${avgMargin}%` : '–'} hint="wg rekomendacji lub przypisania" />
        <StatTile label="Wolne auta" value={`${freeVehicles} / ${data?.vehicles.length ?? 0}`} hint={`${data?.carriers.length ?? 0} podwykonawców w bazie`} />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <AgentPanel agent="logistics.pricing_agent" title="Zapytaj agenta o wycenę" className="flex-1 min-w-[280px]" />
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Odśwież
        </Button>
      </div>

      {!loading && items.length === 0 ? (
        <EmptyState title="Brak zleceń transportowych" description="Uruchom `yarn mercato logistics seed`, żeby wczytać dane demo, albo dodaj zamówienie z adresem załadunku i rozładunku." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nr</TableHead>
                <TableHead>Klient</TableHead>
                <TableHead>Trasa</TableHead>
                <TableHead>Załadunek</TableHead>
                <TableHead className="text-right">Ładunek</TableHead>
                <TableHead className="text-right">Cena klienta</TableHead>
                <TableHead className="text-right">Koszt</TableHead>
                <TableHead className="text-right">Marża</TableHead>
                <TableHead>Rekomendacja</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((job) => {
                const p = job.pricing
                const rec = RECOMMENDATION_LABELS[p.recommendation]
                const chosenCost = p.recommendation === 'subcontractor' ? p.bestCarrier?.cost ?? null : p.ownFleet.cost
                const chosenMargin = job.marginPct ?? (p.recommendation === 'subcontractor' ? p.bestCarrier?.marginPct ?? null : p.ownFleet.marginPct)
                const assigned = job.dispatchMode !== 'unassigned'
                const isOpen = openId === job.id
                return (
                  <React.Fragment key={job.id}>
                    <TableRow className="cursor-pointer" onClick={() => setOpenId(isOpen ? null : job.id)}>
                      <TableCell className="font-medium">{job.orderNumber}</TableCell>
                      <TableCell>{job.clientName}</TableCell>
                      <TableCell>
                        <div className="font-medium">{cityOf(job.pickupAddress)} → {cityOf(job.deliveryAddress)}</div>
                        <div className="text-xs text-muted-foreground">{p.route.distanceKm} km · {p.route.driveHours} h{p.route.known ? '' : ' · miasto nieznane'}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{job.pickupStart ? dateShort.format(new Date(job.pickupStart)) : '–'}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{job.pallets ?? '–'} pal · {job.weightKg ? `${(job.weightKg / 1000).toFixed(1)} t` : '–'}</TableCell>
                      <TableCell className="text-right tabular-nums">{job.clientPrice != null ? pln.format(job.clientPrice) : <span className="text-muted-foreground">sug. {pln.format(p.suggestedClientPrice)}</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{chosenCost != null ? pln.format(chosenCost) : '–'}</TableCell>
                      <TableCell className={`text-right tabular-nums font-medium ${chosenMargin != null && chosenMargin < 10 ? 'text-destructive' : ''}`}>{chosenMargin != null ? `${chosenMargin}%` : '–'}</TableCell>
                      <TableCell><Badge variant={rec?.variant ?? 'outline'}>{rec?.label ?? p.recommendation}</Badge></TableCell>
                      <TableCell>
                        <DispatchBadge mode={job.dispatchMode} />
                        {job.assignedVehicle ? <div className="mt-1 text-xs text-muted-foreground">{job.assignedVehicle}</div> : null}
                        {job.assignedCarrier ? <div className="mt-1 text-xs text-muted-foreground">{job.assignedCarrier}</div> : null}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        {assigned ? null : (
                          <Button type="button" size="sm" disabled={busyId === job.id || (p.recommendation !== 'own_fleet' && p.recommendation !== 'subcontractor')} onClick={() => void approve(job)}>
                            {busyId === job.id ? 'Zapisuję…' : 'Zatwierdź'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                    {isOpen ? (
                      <TableRow>
                        <TableCell colSpan={11} className="bg-muted/40">
                          <div className="grid gap-4 py-2 md:grid-cols-3">
                            <div>
                              <p className="text-xs font-medium uppercase text-muted-foreground">Uzasadnienie agenta</p>
                              <p className="mt-1 text-sm">{p.rationale}</p>
                              {job.dispatchNote ? <p className="mt-2 text-xs text-muted-foreground">Notatka: {job.dispatchNote}</p> : null}
                            </div>
                            <div>
                              <p className="text-xs font-medium uppercase text-muted-foreground">Własna flota</p>
                              <p className="mt-1 text-sm">Koszt {pln.format(p.ownFleet.cost)} · marża {p.ownFleet.marginPct != null ? `${p.ownFleet.marginPct}%` : '–'}</p>
                              <p className="text-xs text-muted-foreground">{p.ownFleet.availableVehicle ? `Wolne auto: ${p.ownFleet.availableVehicle.plate} (${p.ownFleet.availableVehicle.capacityPallets} pal)` : 'Brak wolnego auta o wystarczającej ładowności'}</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium uppercase text-muted-foreground">Oferty podwykonawców</p>
                              <ul className="mt-1 space-y-1 text-sm">
                                {p.carrierOffers.map((offer) => (
                                  <li key={offer.id} className={offer.withinCeiling && !offer.risky ? '' : 'text-muted-foreground line-through'}>
                                    {offer.name}: {pln.format(offer.cost)} · {offer.marginPct != null ? `${offer.marginPct}%` : '–'} · ocena {offer.rating}/5{offer.negotiable ? ' · negocjuje' : ''}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </React.Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
