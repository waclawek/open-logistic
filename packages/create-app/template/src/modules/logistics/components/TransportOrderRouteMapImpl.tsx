'use client'

import { useEffect, useRef } from 'react'
import * as L from 'leaflet'
import type { TransportOrderRouteMapProps } from './TransportOrderRouteMap'

const leaflet = ((L as { default?: typeof L }).default ?? L) as typeof L

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

export default function TransportOrderRouteMapImpl({ order }: TransportOrderRouteMapProps) {
  const mapEl = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  const pickup = order.stops.find((s) => s.role === 'pickup') ?? order.stops[0]
  const delivery =
    order.stops.find((s) => s.role === 'delivery') ?? order.stops[order.stops.length - 1]
  const centerLat = pickup?.lat ?? 52.1
  const centerLng = pickup?.lng ?? 19.4

  useEffect(() => {
    const node = mapEl.current
    if (!node || mapRef.current) return undefined

    const map = leaflet.map(node, {
      center: [centerLat, centerLng],
      zoom: 6,
      scrollWheelZoom: false,
    })
    leaflet.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map)
    mapRef.current = map

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize()
    })
    resizeObserver.observe(node)
    requestAnimationFrame(() => map.invalidateSize())

    return () => {
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !pickup || !delivery) return

    if (layerRef.current) map.removeLayer(layerRef.current)

    const latlngs: L.LatLngTuple[] = order.route?.points?.coordinates?.length
      ? order.route.points.coordinates.map(([lng, lat]) => [lat, lng] as L.LatLngTuple)
      : [
          [pickup.lat, pickup.lng],
          [delivery.lat, delivery.lng],
        ]

    layerRef.current = leaflet
      .layerGroup([
        leaflet.polyline(latlngs, { color: '#2563eb', weight: 5, opacity: 0.85 }),
        leaflet.circleMarker([pickup.lat, pickup.lng], {
          radius: 7,
          color: '#16a34a',
          fillColor: '#16a34a',
          fillOpacity: 1,
        }),
        leaflet.circleMarker([delivery.lat, delivery.lng], {
          radius: 7,
          color: '#dc2626',
          fillColor: '#dc2626',
          fillOpacity: 1,
        }),
      ])
      .addTo(map)
    map.fitBounds(leaflet.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 10 })
    requestAnimationFrame(() => map.invalidateSize())
  }, [order, pickup, delivery])

  return (
    <div
      ref={mapEl}
      className="h-72 w-full overflow-hidden rounded-md border border-border bg-muted/30"
    />
  )
}
