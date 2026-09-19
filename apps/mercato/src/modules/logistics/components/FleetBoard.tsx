'use client'

import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { StatTile } from './shared'

type Vehicle = { id: string; name: string; plate: string; capacityPallets: number; maxWeightKg: number; homeBase: string; status: string; assignedJob: { orderNumber: string; from: string | null; to: string | null } | null }
type Driver = { id: string; name: string; phone: string | null; licenses: string | null; status: string }
type Payload = { vehicles: Vehicle[]; drivers: Driver[]; jobs: unknown[] }

const VEHICLE_STATUS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  available: { label: 'Wolne', variant: 'default' },
  in_transit: { label: 'W trasie', variant: 'secondary' },
  maintenance: { label: 'Serwis', variant: 'destructive' },
}
const DRIVER_STATUS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  available: { label: 'Dostępny', variant: 'default' },
  on_route: { label: 'W trasie', variant: 'secondary' },
  off_duty: { label: 'Po służbie', variant: 'outline' },
}

export function FleetBoard() {
  const [data, setData] = React.useState<Payload | null>(null)
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setLoading(true)
    const call = await apiCall<Payload>('/api/logistics/fleet')
    if (call.ok && call.result) setData(call.result)
    else flash('Nie udało się wczytać floty.', 'error')
    setLoading(false)
  }, [])
  React.useEffect(() => { void load() }, [load])

  const vehicles = data?.vehicles ?? []
  const drivers = data?.drivers ?? []
  const free = vehicles.filter((v) => v.status === 'available').length
  const capacity = vehicles.filter((v) => v.status !== 'maintenance').reduce((s, v) => s + v.capacityPallets, 0)

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Pojazdy" value={vehicles.length} hint={`${free} wolne · ${vehicles.filter((v) => v.status === 'in_transit').length} w trasie · ${vehicles.filter((v) => v.status === 'maintenance').length} w serwisie`} />
        <StatTile label="Dostępna ładowność" value={`${capacity} pal`} hint="bez aut w serwisie" />
        <StatTile label="Kierowcy" value={drivers.length} hint={`${drivers.filter((d) => d.status === 'available').length} dostępnych`} />
        <StatTile label="Wykorzystanie floty" value={vehicles.length ? `${Math.round((vehicles.filter((v) => v.status === 'in_transit' || v.assignedJob).length / vehicles.length) * 100)}%` : '–'} hint="auta z przypisanym zleceniem" />
      </div>

      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Odśwież
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Pojazdy</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rejestracja</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead className="text-right">Palety</TableHead>
                  <TableHead className="text-right">DMC</TableHead>
                  <TableHead>Baza</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Zlecenie</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.map((v) => {
                  const st = VEHICLE_STATUS[v.status] ?? { label: v.status, variant: 'outline' as const }
                  return (
                    <TableRow key={v.id}>
                      <TableCell className="font-medium">{v.plate}</TableCell>
                      <TableCell className="text-muted-foreground">{v.capacityPallets >= 30 ? 'Ciągnik z naczepą' : 'Solówka'}</TableCell>
                      <TableCell className="text-right tabular-nums">{v.capacityPallets}</TableCell>
                      <TableCell className="text-right tabular-nums">{(v.maxWeightKg / 1000).toFixed(0)} t</TableCell>
                      <TableCell>{v.homeBase}</TableCell>
                      <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{v.assignedJob ? `${v.assignedJob.orderNumber} · ${v.assignedJob.from ?? '?'} → ${v.assignedJob.to ?? '?'}` : '–'}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">Kierowcy</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kierowca</TableHead>
                  <TableHead>Telefon</TableHead>
                  <TableHead>Kategorie</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drivers.map((d) => {
                  const st = DRIVER_STATUS[d.status] ?? { label: d.status, variant: 'outline' as const }
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell className="text-muted-foreground">{d.phone ?? '–'}</TableCell>
                      <TableCell>{d.licenses ?? '–'}</TableCell>
                      <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      </div>
      <p className="text-xs text-muted-foreground">Prototyp: dane pochodzą z modułów Zasoby i Pracownicy z polami dodanymi przez Logistykę. Status auta zmienia się ręcznie w karcie zasobu.</p>
    </div>
  )
}
