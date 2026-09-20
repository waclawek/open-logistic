'use client'

import * as React from 'react'
import { MapPin } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import 'leaflet/dist/leaflet.css'
import { MAP_CENTER, resolveCityCoords, type LatLng } from '../../lib/city-coords'
import type { RouteBoardItem } from '../../lib/routes-board'

export type FleetVehicle = {
  id: string
  label: string
  detail: string
  position: LatLng
}

export type FleetPin = {
  id: string
  kind: 'pickup' | 'delivery'
  label: string
  position: LatLng
  highlighted: boolean
}

export type FleetMapImplProps = {
  center: LatLng
  vehicles: FleetVehicle[]
  pins: FleetPin[]
  selectedTransportId: string | null
}

type FleetMapImplComponent = (props: FleetMapImplProps) => React.ReactElement

type ExchangeVehicle = {
  id: string
  provider: string
  locality: string
  lat: number
  lng: number
  vehicleType: string
  capacityT: number
  remark?: string
}

/** Every free vehicle the exchange simulator knows about (search from the map center, wide radius). */
async function fetchAllVehicles(signal?: AbortSignal): Promise<FleetVehicle[]> {
  const call = await apiCall<{ items: ExchangeVehicle[] }>('/api/logistics/exchange/search-vehicles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat: MAP_CENTER.lat, lng: MAP_CENTER.lng, radiusKm: 2000 }),
    signal,
  })
  if (!call.ok || !call.result) return []
  return call.result.items.map((vehicle) => ({
    id: vehicle.id,
    label: `${vehicle.vehicleType} · ${vehicle.locality}`,
    detail: `${vehicle.provider.toUpperCase()} · ${vehicle.capacityT} t${vehicle.remark ? ` · ${vehicle.remark}` : ''}`,
    position: { lat: vehicle.lat, lng: vehicle.lng },
  }))
}

/** Pins for every transport whose address mentions a known city; the selected one is emphasised. */
export function buildPins(items: RouteBoardItem[], selectedTransportId: string | null): FleetPin[] {
  const pins: FleetPin[] = []
  for (const item of items) {
    const highlighted = item.id === selectedTransportId
    const pickup = resolveCityCoords(item.pickupAddress)
    const delivery = resolveCityCoords(item.deliveryAddress)
    if (pickup) pins.push({ id: `${item.id}:pickup`, kind: 'pickup', label: `${item.orderNumber} · ${item.pickupAddress}`, position: pickup, highlighted })
    if (delivery) pins.push({ id: `${item.id}:delivery`, kind: 'delivery', label: `${item.orderNumber} · ${item.deliveryAddress}`, position: delivery, highlighted })
  }
  return pins
}

/**
 * Lazy shell around Leaflet (same pattern as TransportRunMap): CSS imports safely on the
 * server, the JS implementation only loads in the browser because Leaflet touches `window`.
 */
export function FleetMap({ items, selectedTransportId }: { items: RouteBoardItem[]; selectedTransportId: string | null }) {
  const t = useT()
  const [Impl, setImpl] = React.useState<FleetMapImplComponent | null>(null)
  const [vehicles, setVehicles] = React.useState<FleetVehicle[]>([])

  React.useEffect(() => {
    let cancelled = false
    void import('./FleetMapImpl').then((mod) => {
      if (!cancelled) setImpl(() => mod.default)
    })
    return () => { cancelled = true }
  }, [])

  React.useEffect(() => {
    const controller = new AbortController()
    void fetchAllVehicles(controller.signal).then((loaded) => {
      if (!controller.signal.aborted) setVehicles(loaded)
    }).catch(() => undefined)
    return () => controller.abort()
  }, [])

  const pins = React.useMemo(() => buildPins(items, selectedTransportId), [items, selectedTransportId])

  return (
    <section className="flex min-h-80 flex-col overflow-hidden rounded-lg border border-border bg-card" data-testid="board-map">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <MapPin className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t('logistics.board.map.title')}</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {t('logistics.board.map.summary', { vehicles: vehicles.length, transports: items.length })}
        </span>
      </header>
      <div className="relative min-h-72 flex-1">
        {Impl ? (
          <Impl center={MAP_CENTER} vehicles={vehicles} pins={pins} selectedTransportId={selectedTransportId} />
        ) : (
          <div className="flex h-full min-h-72 items-center justify-center bg-muted/30">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        )}
      </div>
    </section>
  )
}
