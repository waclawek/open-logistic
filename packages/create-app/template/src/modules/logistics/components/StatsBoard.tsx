'use client'

import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { TransportJob, BackhaulProposal } from '../lib/backhaul'
import type { PriceJobResult, VehicleProfile } from '../lib/pricing'
import { StatTile, pln } from './shared'

type JobRow = TransportJob & { pricing: PriceJobResult }
type JobsPayload = { items: JobRow[]; vehicles: VehicleProfile[] }
type BackhaulPayload = { proposals: BackhaulProposal[] }

function Bar({ label, value, max, suffix, tone = 'bg-primary' }: { label: string; value: number; max: number; suffix: string; tone?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm"><span>{label}</span><span className="tabular-nums text-muted-foreground">{value}{suffix}</span></div>
      <div className="h-2 w-full rounded-full bg-muted"><div className={`h-2 rounded-full ${tone}`} style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

export function StatsBoard() {
  const [jobs, setJobs] = React.useState<JobsPayload | null>(null)
  const [backhaul, setBackhaul] = React.useState<BackhaulPayload | null>(null)
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    const [a, b] = await Promise.all([apiCall<JobsPayload>('/api/logistics/transport-jobs'), apiCall<BackhaulPayload>('/api/logistics/backhaul')])
    if (a.ok && a.result) setJobs(a.result); else flash('Nie udało się wczytać zleceń.', 'error')
    if (b.ok && b.result) setBackhaul(b.result)
    setLoading(false)
  }, [])
  React.useEffect(() => { void load() }, [load])

  const items = jobs?.items ?? []
  const revenue = items.reduce((s, j) => s + (j.clientPrice ?? 0), 0)
  const cost = items.reduce((s, j) => s + (j.dispatchMode === 'subcontractor' ? j.carrierCost ?? j.pricing.bestCarrier?.cost ?? 0 : j.pricing.ownFleet.cost), 0)
  const marginPln = revenue - cost
  const marginPct = revenue > 0 ? Math.round((marginPln / revenue) * 1000) / 10 : 0
  const km = items.reduce((s, j) => s + j.pricing.route.distanceKm, 0)
  const own = items.filter((j) => j.dispatchMode === 'own_fleet').length
  const sub = items.filter((j) => j.dispatchMode === 'subcontractor').length
  const open = items.length - own - sub
  const proposals = backhaul?.proposals ?? []
  const savedKm = proposals.filter((p) => p.feasible).reduce((s, p) => s + p.savedKm, 0)
  const savedPln = proposals.filter((p) => p.feasible).reduce((s, p) => s + p.savedCostPln, 0)
  const byClient = new Map<string, { revenue: number; jobs: number }>()
  for (const j of items) { const c = byClient.get(j.clientName) ?? { revenue: 0, jobs: 0 }; c.revenue += j.clientPrice ?? 0; c.jobs += 1; byClient.set(j.clientName, c) }
  const byVehicle = new Map<string, number>()
  for (const j of items) if (j.assignedVehicle) byVehicle.set(j.assignedVehicle, (byVehicle.get(j.assignedVehicle) ?? 0) + j.pricing.route.distanceKm)
  const carrierUse = new Map<string, number>()
  for (const j of items) if (j.assignedCarrier) carrierUse.set(j.assignedCarrier, (carrierUse.get(j.assignedCarrier) ?? 0) + 1)
  const maxClient = Math.max(0, ...[...byClient.values()].map((c) => c.revenue))
  const maxVehicle = Math.max(0, ...byVehicle.values())

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Przychód (tydzień)" value={pln.format(revenue)} hint={`${items.length} zleceń · ${km} km`} />
        <StatTile label="Marża" value={`${marginPct}%`} hint={`${pln.format(marginPln)} po kosztach transportu`} />
        <StatTile label="Przychód na km" value={km ? `${(revenue / km).toFixed(2)} zł` : '–'} hint="cel: powyżej 4,00 zł/km" />
        <StatTile label="Puste km do odzyskania" value={`${savedKm} km`} hint={`${pln.format(savedPln)} przez łączenie tras`} />
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Odśwież
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3 rounded-lg border border-border bg-card p-5">
          <h2 className="text-base font-semibold">Kto wiezie</h2>
          <Bar label="Własna flota" value={own} max={items.length} suffix=" zleceń" />
          <Bar label="Podwykonawcy" value={sub} max={items.length} suffix=" zleceń" tone="bg-amber-500" />
          <Bar label="Nieprzypisane" value={open} max={items.length} suffix=" zleceń" tone="bg-muted-foreground" />
        </section>
        <section className="space-y-3 rounded-lg border border-border bg-card p-5">
          <h2 className="text-base font-semibold">Przychód wg klienta</h2>
          {[...byClient.entries()].sort((a, b) => b[1].revenue - a[1].revenue).map(([name, c]) => (
            <Bar key={name} label={`${name} (${c.jobs})`} value={c.revenue} max={maxClient} suffix=" zł" />
          ))}
        </section>
        <section className="space-y-3 rounded-lg border border-border bg-card p-5">
          <h2 className="text-base font-semibold">Kilometry na auto</h2>
          {byVehicle.size === 0 ? <p className="text-sm text-muted-foreground">Żadne zlecenie nie ma jeszcze przypisanego auta.</p> : null}
          {[...byVehicle.entries()].sort((a, b) => b[1] - a[1]).map(([plate, v]) => (
            <Bar key={plate} label={plate} value={v} max={maxVehicle} suffix=" km" />
          ))}
        </section>
        <section className="space-y-3 rounded-lg border border-border bg-card p-5">
          <h2 className="text-base font-semibold">Rekomendacje agenta</h2>
          {(['own_fleet', 'subcontractor', 'negotiate', 'human_review'] as const).map((rec) => (
            <Bar key={rec} label={{ own_fleet: 'Własne auto', subcontractor: 'Podwykonawca', negotiate: 'Negocjuj', human_review: 'Decyzja człowieka' }[rec]} value={items.filter((j) => j.pricing.recommendation === rec).length} max={items.length} suffix="" tone={rec === 'human_review' ? 'bg-destructive' : rec === 'own_fleet' ? 'bg-primary' : 'bg-amber-500'} />
          ))}
          {carrierUse.size ? <p className="pt-2 text-xs text-muted-foreground">Podwykonawcy w użyciu: {[...carrierUse.entries()].map(([n, c]) => `${n} (${c})`).join(', ')}</p> : null}
        </section>
      </div>
      <p className="text-xs text-muted-foreground">Prototyp: liczby liczone na bieżąco ze zleceń w systemie i deterministycznych reguł wyceny (3,10 PLN/km własne auto). Historia i trendy wymagają modułu analytics.</p>
    </div>
  )
}
