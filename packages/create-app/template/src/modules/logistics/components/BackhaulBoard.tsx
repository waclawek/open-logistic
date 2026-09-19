'use client'

import * as React from 'react'
import { ArrowRight, RefreshCw, Truck } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { BackhaulProposal, TransportJob } from '../lib/backhaul'
import type { VehicleProfile } from '../lib/pricing'
import { AgentPanel, DispatchBadge, StatTile, cityOf, dateShort, pln, updateDispatch } from './shared'

type Payload = { proposals: BackhaulProposal[]; jobs: TransportJob[]; vehicles: VehicleProfile[]; homeBase: string }

export function BackhaulBoard() {
  const [data, setData] = React.useState<Payload | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    const call = await apiCall<Payload>('/api/logistics/backhaul')
    if (call.ok && call.result) setData(call.result)
    else flash('Nie udało się wczytać propozycji tras.', 'error')
    setLoading(false)
  }, [])

  React.useEffect(() => { void load() }, [load])

  const combine = async (proposal: BackhaulProposal) => {
    const vehicle = (data?.vehicles ?? []).find((v) => v.status === 'available' && v.capacityPallets >= Math.max(proposal.first.pallets ?? 0, proposal.second.pallets ?? 0))
    if (!vehicle) {
      flash('Brak wolnego auta o wystarczającej ładowności.', 'error')
      return
    }
    setBusyId(proposal.id)
    const note = `[Planista] Przejazd łączony ${proposal.first.orderNumber} + ${proposal.second.orderNumber}: ${proposal.rationale}`
    const first = await updateDispatch(proposal.first.id, {
      dispatch_mode: 'own_fleet',
      assigned_vehicle: vehicle.plate,
      assigned_carrier: null,
      margin_pct: proposal.combinedMarginPct,
      dispatch_note: note,
    })
    const second = first.ok
      ? await updateDispatch(proposal.second.id, {
          dispatch_mode: 'own_fleet',
          assigned_vehicle: vehicle.plate,
          assigned_carrier: null,
          margin_pct: proposal.combinedMarginPct,
          dispatch_note: note,
        })
      : first
    setBusyId(null)
    if (first.ok && second.ok) {
      flash(`Połączono w jeden przejazd autem ${vehicle.plate}.`, 'success')
      await load()
    } else {
      flash(`Nie udało się zapisać: ${first.error ?? second.error}`, 'error')
    }
  }

  const proposals = data?.proposals ?? []
  const jobs = data?.jobs ?? []
  const totalSavedKm = proposals.filter((p) => p.feasible).reduce((sum, p) => sum + p.savedKm, 0)
  const totalSavedPln = proposals.filter((p) => p.feasible).reduce((sum, p) => sum + p.savedCostPln, 0)
  const emptyKmSolo = proposals.reduce((sum, p) => sum + p.emptyKmSolo, 0)
  const emptyKmCombined = proposals.reduce((sum, p) => sum + p.emptyKmCombined, 0)

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Propozycje połączeń" value={proposals.length} hint={`${proposals.filter((p) => p.feasible).length} wykonalne od ręki`} />
        <StatTile label="Puste km do uniknięcia" value={`${totalSavedKm} km`} hint={`${emptyKmSolo} km pusto osobno → ${emptyKmCombined} km po połączeniu`} />
        <StatTile label="Oszczędność" value={pln.format(totalSavedPln)} hint="koszt własny 3,10 PLN/km" />
        <StatTile label="Zlecenia w puli" value={jobs.length} hint={`baza: ${data?.homeBase ?? 'Wrocław'}`} />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <AgentPanel agent="logistics.route_planner" title="Zapytaj planistę tras" className="flex-1 min-w-[280px]" />
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Odśwież
        </Button>
      </div>

      {!loading && proposals.length === 0 ? (
        <EmptyState title="Brak zleceń do połączenia" description="Żadna para zleceń nie oszczędza co najmniej 80 km. Dodaj zlecenia z załadunkiem w pobliżu rozładunku innego." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {proposals.map((p) => {
            const done = p.first.dispatchMode === 'own_fleet' && p.second.dispatchMode === 'own_fleet' && p.first.assignedVehicle && p.first.assignedVehicle === p.second.assignedVehicle
            return (
              <div key={p.id} className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-base font-semibold">
                      <Truck className="size-4 text-muted-foreground" aria-hidden="true" />
                      {p.first.orderNumber} <ArrowRight className="size-4" aria-hidden="true" /> {p.second.orderNumber}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {cityOf(p.first.pickupAddress)} → {cityOf(p.first.deliveryAddress)} → {cityOf(p.second.pickupAddress)} → {cityOf(p.second.deliveryAddress)} → {data?.homeBase}
                    </p>
                  </div>
                  <Badge variant={p.feasible ? 'default' : 'destructive'}>{p.feasible ? 'Wykonalne' : 'Koliduje termin'}</Badge>
                </div>

                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-md bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground">Oszczędność</p>
                    <p className="text-lg font-semibold tabular-nums">{p.savedKm} km</p>
                    <p className="text-xs text-muted-foreground">≈ {pln.format(p.savedCostPln)}</p>
                  </div>
                  <div className="rounded-md bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground">Puste km</p>
                    <p className="text-lg font-semibold tabular-nums">{p.emptyKmSolo} → {p.emptyKmCombined}</p>
                    <p className="text-xs text-muted-foreground">osobno → razem</p>
                  </div>
                  <div className="rounded-md bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground">Marża łączna</p>
                    <p className="text-lg font-semibold tabular-nums">{p.combinedMarginPct != null ? `${p.combinedMarginPct}%` : '–'}</p>
                    <p className="text-xs text-muted-foreground">{pln.format(p.combinedRevenue)} przychodu</p>
                  </div>
                </div>

                <ol className="space-y-1 text-sm">
                  {p.legs.map((leg, idx) => (
                    <li key={idx} className="flex items-center justify-between gap-2">
                      <span className={leg.empty ? 'text-muted-foreground' : ''}>{leg.empty ? '○' : '●'} {leg.label}</span>
                      <span className="tabular-nums text-muted-foreground">{leg.km} km</span>
                    </li>
                  ))}
                </ol>

                <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <div>
                    <div className="flex items-center gap-2"><DispatchBadge mode={p.first.dispatchMode} /> {p.first.clientName}</div>
                    <div className="mt-1">Załadunek {p.first.pickupStart ? dateShort.format(new Date(p.first.pickupStart)) : '–'} · {p.first.pallets ?? '–'} pal</div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2"><DispatchBadge mode={p.second.dispatchMode} /> {p.second.clientName}</div>
                    <div className="mt-1">Okno do {p.second.pickupEnd ? dateShort.format(new Date(p.second.pickupEnd)) : '–'} · {p.second.pallets ?? '–'} pal</div>
                  </div>
                </div>

                <p className="text-sm">{p.rationale}</p>

                <div className="flex justify-end">
                  {done ? (
                    <Badge variant="secondary">Połączone · {p.first.assignedVehicle}</Badge>
                  ) : (
                    <Button type="button" disabled={busyId === p.id} onClick={() => void combine(p)}>
                      {busyId === p.id ? 'Zapisuję…' : 'Połącz w jeden przejazd'}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
