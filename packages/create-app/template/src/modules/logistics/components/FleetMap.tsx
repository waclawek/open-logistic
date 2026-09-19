'use client'

import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { StatTile } from './shared'

type Pt = { lat: number; lng: number }
type JobGeo = { id: string; orderNumber: string; dispatchMode: string; assignedVehicle: string | null; from: (Pt & { city: string }) | null; to: (Pt & { city: string }) | null; distanceKm: number }
type VehicleGeo = { id: string; plate: string; status: string; homeBase: string; position: Pt | null; assignedJob: { orderNumber: string } | null }
type Payload = { vehicles: VehicleGeo[]; jobs: JobGeo[] }

// Schematic map of Central Europe: equirectangular projection into a fixed viewBox.
const BOUNDS = { minLng: 2, maxLng: 26, minLat: 45, maxLat: 56 }
const W = 960
const H = 520
function project(p: Pt): { x: number; y: number } {
  const x = ((p.lng - BOUNDS.minLng) / (BOUNDS.maxLng - BOUNDS.minLng)) * W
  const y = ((BOUNDS.maxLat - p.lat) / (BOUNDS.maxLat - BOUNDS.minLat)) * H
  return { x, y }
}
const cap = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

export function FleetMap() {
  const [data, setData] = React.useState<Payload | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [hover, setHover] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    const call = await apiCall<Payload>('/api/logistics/fleet')
    if (call.ok && call.result) setData(call.result)
    else flash('Nie udało się wczytać mapy.', 'error')
    setLoading(false)
  }, [])
  React.useEffect(() => { void load() }, [load])

  const jobs = (data?.jobs ?? []).filter((j) => j.from && j.to)
  const vehicles = (data?.vehicles ?? []).filter((v) => v.position)
  const cities = new Map<string, Pt>()
  for (const j of jobs) { if (j.from) cities.set(j.from.city, j.from); if (j.to) cities.set(j.to.city, j.to) }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Zlecenia na mapie" value={jobs.length} hint={`${jobs.filter((j) => j.dispatchMode === 'unassigned').length} bez przypisania`} />
        <StatTile label="Auta z pozycją" value={vehicles.length} hint="w trasie = połowa trasy zlecenia, inaczej baza" />
        <StatTile label="Źródło pozycji" value="Symulacja" hint="prototyp: brak telematyki, brak podkładu mapowego" />
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Odśwież
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Schematyczna mapa floty">
          <rect x="0" y="0" width={W} height={H} className="fill-muted/40" />
          {Array.from({ length: 12 }).map((_, i) => (
            <line key={`v${i}`} x1={(i * W) / 12} y1="0" x2={(i * W) / 12} y2={H} className="stroke-border" strokeWidth="0.5" />
          ))}
          {Array.from({ length: 6 }).map((_, i) => (
            <line key={`h${i}`} x1="0" y1={(i * H) / 6} x2={W} y2={(i * H) / 6} className="stroke-border" strokeWidth="0.5" />
          ))}
          {jobs.map((j) => {
            const a = project(j.from!)
            const b = project(j.to!)
            const active = hover === j.id
            const color = j.dispatchMode === 'own_fleet' ? 'stroke-primary' : j.dispatchMode === 'subcontractor' ? 'stroke-amber-500' : 'stroke-muted-foreground'
            return (
              <g key={j.id} onMouseEnter={() => setHover(j.id)} onMouseLeave={() => setHover(null)}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={color} strokeWidth={active ? 4 : 2} strokeDasharray={j.dispatchMode === 'unassigned' ? '6 6' : undefined} strokeLinecap="round" />
                <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 8} textAnchor="middle" className="fill-foreground text-[11px]" style={{ opacity: active ? 1 : 0.7 }}>
                  {j.orderNumber.replace('ORDER-', '')} · {j.distanceKm} km
                </text>
              </g>
            )
          })}
          {[...cities.entries()].map(([city, p]) => {
            const q = project(p)
            return (
              <g key={city}>
                <circle cx={q.x} cy={q.y} r="5" className="fill-background stroke-foreground" strokeWidth="1.5" />
                <text x={q.x + 8} y={q.y + 4} className="fill-foreground text-[12px] font-medium">{cap(city)}</text>
              </g>
            )
          })}
          {vehicles.map((v, i) => {
            const q = project(v.position!)
            const dx = (i % 3) * 14 - 14
            const color = v.status === 'in_transit' ? 'fill-primary' : v.status === 'maintenance' ? 'fill-destructive' : 'fill-emerald-500'
            return (
              <g key={v.id} transform={`translate(${q.x + dx}, ${q.y - 18})`}>
                <rect x="-9" y="-7" width="18" height="12" rx="2" className={`${color} stroke-background`} strokeWidth="1.5" />
                <circle cx="-5" cy="6" r="2" className="fill-foreground" />
                <circle cx="5" cy="6" r="2" className="fill-foreground" />
                <title>{v.plate} · {v.status}{v.assignedJob ? ` · ${v.assignedJob.orderNumber}` : ''}</title>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span><span className="inline-block h-2 w-6 bg-primary align-middle" /> własna flota</span>
        <span><span className="inline-block h-2 w-6 bg-amber-500 align-middle" /> podwykonawca</span>
        <span><span className="inline-block h-0 w-6 border-t-2 border-dashed border-muted-foreground align-middle" /> nieprzypisane</span>
        <span><span className="inline-block h-3 w-4 rounded-sm bg-emerald-500 align-middle" /> auto wolne</span>
        <span><span className="inline-block h-3 w-4 rounded-sm bg-primary align-middle" /> auto w trasie</span>
        <span><span className="inline-block h-3 w-4 rounded-sm bg-destructive align-middle" /> auto w serwisie</span>
      </div>
    </div>
  )
}
