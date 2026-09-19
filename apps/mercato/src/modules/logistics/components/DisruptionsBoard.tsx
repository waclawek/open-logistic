'use client'

import * as React from 'react'
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import type { TransportJob } from '../lib/backhaul'
import type { PriceJobResult, CarrierProfile } from '../lib/pricing'
import { AgentPanel, DispatchBadge, RECOMMENDATION_LABELS, StatTile, cityOf, dateShort, pln, updateDispatch } from './shared'

type JobRow = TransportJob & { pricing: PriceJobResult }
type JobsPayload = { items: JobRow[]; carriers: CarrierProfile[] }
type Replan = { job: TransportJob; excludedCarrier: string | null; planB: PriceJobResult; hoursToPickup: number | null }

type Incident = { id: string; job: JobRow; carrier: string; kind: 'cancelled' | 'delayed'; createdAt: number; replan?: Replan; resolved?: boolean }

export function DisruptionsBoard() {
  const [data, setData] = React.useState<JobsPayload | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [incidents, setIncidents] = React.useState<Incident[]>([])
  const [busy, setBusy] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    const call = await apiCall<JobsPayload>('/api/logistics/transport-jobs')
    if (call.ok && call.result) setData(call.result)
    else flash('Nie udało się wczytać zleceń.', 'error')
    setLoading(false)
  }, [])
  React.useEffect(() => { void load() }, [load])

  const items = data?.items ?? []
  const subcontracted = items.filter((j) => j.dispatchMode === 'subcontractor' && j.assignedCarrier)
  const candidates = subcontracted.length ? subcontracted : items.filter((j) => j.pricing.bestCarrier)

  const simulate = async (job: JobRow) => {
    const carrier = job.assignedCarrier ?? job.pricing.bestCarrier?.name ?? 'Przewoźnik'
    const id = `${job.id}-${Date.now()}`
    setIncidents((list) => [{ id, job, carrier, kind: 'cancelled', createdAt: Date.now() }, ...list])
    setBusy(id)
    const call = await apiCall<Replan>(`/api/logistics/replan?orderId=${encodeURIComponent(job.id)}&excludeCarrier=${encodeURIComponent(carrier)}`)
    setBusy(null)
    if (call.ok && call.result) {
      setIncidents((list) => list.map((inc) => (inc.id === id ? { ...inc, replan: call.result! } : inc)))
    } else {
      flash('Agent nie zdołał policzyć planu B.', 'error')
    }
  }

  const apply = async (inc: Incident) => {
    const plan = inc.replan?.planB
    if (!plan) return
    const rec = plan.recommendation
    if (rec !== 'own_fleet' && rec !== 'subcontractor') {
      flash('Plan B wymaga decyzji dyspozytora — brak automatycznego przypisania.', 'info')
      return
    }
    setBusy(inc.id)
    const note = `[Agent ratunkowy] ${inc.carrier} anulował. ${plan.rationale}`
    const result = await updateDispatch(inc.job.id, rec === 'own_fleet'
      ? { dispatch_mode: 'own_fleet', assigned_vehicle: plan.ownFleet.availableVehicle?.plate ?? null, assigned_carrier: null, carrier_cost: plan.ownFleet.cost, margin_pct: plan.ownFleet.marginPct, dispatch_note: note }
      : { dispatch_mode: 'subcontractor', assigned_vehicle: null, assigned_carrier: plan.bestCarrier?.name ?? null, carrier_cost: plan.bestCarrier?.cost ?? null, margin_pct: plan.bestCarrier?.marginPct ?? null, dispatch_note: note })
    setBusy(null)
    if (result.ok) {
      flash(`Zlecenie ${inc.job.orderNumber} uratowane.`, 'success')
      setIncidents((list) => list.map((i) => (i.id === inc.id ? { ...i, resolved: true } : i)))
      await load()
    } else {
      flash(`Nie udało się zapisać: ${result.error}`, 'error')
    }
  }

  const openIncidents = incidents.filter((i) => !i.resolved).length

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Otwarte zakłócenia" value={openIncidents} hint={`${incidents.filter((i) => i.resolved).length} rozwiązanych w tej sesji`} />
        <StatTile label="Zlecenia u podwykonawców" value={subcontracted.length} hint="narażone na anulowanie" />
        <StatTile label="Zlecenia w ciągu 24 h" value={items.filter((j) => j.pickupStart && new Date(j.pickupStart).getTime() - Date.now() < 864e5).length} hint="najkrótszy czas na plan B" />
        <StatTile label="Podwykonawcy w bazie" value={data?.carriers.length ?? 0} hint={`${(data?.carriers ?? []).filter((c) => c.rating <= 2).length} z niską oceną`} />
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <AgentPanel agent="logistics.route_planner" title="Zapytaj agenta o plan B" className="flex-1 min-w-[280px]" />
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Odśwież
        </Button>
      </div>

      <section className="space-y-3 rounded-lg border border-dashed border-border p-5">
        <h2 className="text-base font-semibold">Symulator zakłócenia</h2>
        <p className="text-sm text-muted-foreground">Prototyp: w produkcji zdarzenie przychodzi mailem lub z API przewoźnika. Tu wybierasz zlecenie, a przewoźnik „anuluje” je od ręki.</p>
        <div className="flex flex-wrap gap-2">
          {candidates.slice(0, 6).map((job) => (
            <Button key={job.id} type="button" variant="secondary" size="sm" disabled={busy !== null} onClick={() => void simulate(job)}>
              <AlertTriangle className="size-4" aria-hidden="true" />
              {job.assignedCarrier ?? job.pricing.bestCarrier?.name} anuluje {job.orderNumber.replace('ORDER-', '')}
            </Button>
          ))}
          {candidates.length === 0 ? <span className="text-sm text-muted-foreground">Brak zleceń z przewoźnikiem — najpierw przypisz podwykonawcę na stronie Zlecenia.</span> : null}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {incidents.map((inc) => {
          const plan = inc.replan?.planB
          const rec = plan ? RECOMMENDATION_LABELS[plan.recommendation] : null
          return (
            <div key={inc.id} className={`flex flex-col gap-4 rounded-lg border p-5 ${inc.resolved ? 'border-border bg-card' : 'border-destructive/50 bg-destructive/5'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-base font-semibold">
                    {inc.resolved ? <ShieldCheck className="size-4 text-emerald-600" aria-hidden="true" /> : <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />}
                    {inc.carrier} anulował {inc.job.orderNumber}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {inc.job.clientName} · {cityOf(inc.job.pickupAddress)} → {cityOf(inc.job.deliveryAddress)} · załadunek {inc.job.pickupStart ? dateShort.format(new Date(inc.job.pickupStart)) : '–'}
                    {inc.replan?.hoursToPickup != null ? ` · za ${inc.replan.hoursToPickup} h` : ''}
                  </p>
                </div>
                <Badge variant={inc.resolved ? 'secondary' : 'destructive'}>{inc.resolved ? 'Rozwiązane' : 'Otwarte'}</Badge>
              </div>

              {!plan ? (
                <p className="text-sm text-muted-foreground">Agent liczy plan B…</p>
              ) : (
                <>
                  <div className="rounded-md bg-background p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Plan B agenta:</span>
                      <Badge variant={rec?.variant ?? 'outline'}>{rec?.label ?? plan.recommendation}</Badge>
                    </div>
                    <p className="mt-2">{plan.rationale}</p>
                    <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                      <span>Własne auto: {pln.format(plan.ownFleet.cost)} · {plan.ownFleet.marginPct != null ? `${plan.ownFleet.marginPct}%` : '–'} · {plan.ownFleet.availableVehicle ? plan.ownFleet.availableVehicle.plate : 'brak wolnego'}</span>
                      <span>Najlepszy inny przewoźnik: {plan.bestCarrier ? `${plan.bestCarrier.name} ${pln.format(plan.bestCarrier.cost)} · ${plan.bestCarrier.marginPct ?? '–'}%` : 'brak w limicie'}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <DispatchBadge mode={inc.resolved ? (plan.recommendation === 'own_fleet' ? 'own_fleet' : 'subcontractor') : inc.job.dispatchMode} />
                    {inc.resolved ? null : (
                      <Button type="button" disabled={busy === inc.id} onClick={() => void apply(inc)}>
                        {busy === inc.id ? 'Zapisuję…' : plan.recommendation === 'own_fleet' || plan.recommendation === 'subcontractor' ? 'Zastosuj plan B' : 'Przekaż dyspozytorowi'}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
