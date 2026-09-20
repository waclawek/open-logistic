'use client'

import { useEffect, useRef } from 'react'
import * as L from 'leaflet'
import type { TransportRunMapProps } from './TransportRunMap'

const leaflet = ((L as { default?: typeof L }).default ?? L) as typeof L

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

/** GraphHopper polyline + live truck + optional backload search radius sweep. */
export default function TransportRunMapImpl({
  route,
  truck,
  scan,
  from,
  to,
}: TransportRunMapProps) {
  const mapEl = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const staticRef = useRef<L.LayerGroup | null>(null)
  const truckMarkerRef = useRef<L.CircleMarker | null>(null)
  const scanCircleRef = useRef<L.Circle | null>(null)
  const fittedKey = useRef<string | null>(null)

  // Create map once + keep size in sync (layout can settle after mount).
  useEffect(() => {
    const node = mapEl.current
    if (!node || mapRef.current) return undefined

    const map = leaflet.map(node, {
      center: [from.lat, from.lng],
      zoom: 6,
      scrollWheelZoom: false,
    })
    leaflet
      .tileLayer(TILE_URL, {
        maxZoom: 19,
        attribution: TILE_ATTRIBUTION,
      })
      .addTo(map)
    mapRef.current = map

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize()
    })
    resizeObserver.observe(node)
    // Next paint after layout — tiles often stay blank until this.
    requestAnimationFrame(() => map.invalidateSize())

    return () => {
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
      truckMarkerRef.current = null
      scanCircleRef.current = null
      staticRef.current = null
      fittedKey.current = null
    }
    // from.* only used as initial center; route updates handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const coords = route?.points?.coordinates
    const latlngs: L.LatLngTuple[] =
      coords && coords.length
        ? coords.map((pair) => [pair[1], pair[0]] as L.LatLngTuple)
        : [
            [from.lat, from.lng],
            [to.lat, to.lng],
          ]

    if (staticRef.current) map.removeLayer(staticRef.current)
    staticRef.current = leaflet
      .layerGroup([
        leaflet.polyline(latlngs, { color: '#2563eb', weight: 5, opacity: 0.85 }),
        leaflet.circleMarker([from.lat, from.lng], {
          radius: 7,
          color: '#16a34a',
          fillColor: '#16a34a',
          fillOpacity: 1,
        }),
        leaflet.circleMarker([to.lat, to.lng], {
          radius: 7,
          color: '#dc2626',
          fillColor: '#dc2626',
          fillOpacity: 1,
        }),
      ])
      .addTo(map)

    const routeKey = `${route?.distanceM ?? 0}:${latlngs.length}:${from.lat}:${to.lat}`
    if (fittedKey.current !== routeKey) {
      map.fitBounds(leaflet.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 10 })
      fittedKey.current = routeKey
      requestAnimationFrame(() => map.invalidateSize())
    }
  }, [route, from.lat, from.lng, to.lat, to.lng])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (truck) {
      const radius = 6 + Math.min(10, truck.usedLdm * 0.35)
      if (!truckMarkerRef.current) {
        truckMarkerRef.current = leaflet
          .circleMarker([truck.lat, truck.lng], {
            radius,
            color: '#0f172a',
            fillColor: '#f59e0b',
            fillOpacity: 0.95,
            weight: 2,
          })
          .addTo(map)
      } else {
        truckMarkerRef.current.setLatLng([truck.lat, truck.lng])
        truckMarkerRef.current.setRadius(radius)
      }
    }

    if (scan?.status === 'scanning' && scan.center) {
      const radiusM = scan.radiusKm * 1000
      if (!scanCircleRef.current) {
        scanCircleRef.current = leaflet
          .circle([scan.center.lat, scan.center.lng], {
            radius: radiusM,
            color: '#7c3aed',
            fillColor: '#a78bfa',
            fillOpacity: 0.18,
            weight: 2,
            dashArray: '6 6',
          })
          .addTo(map)
      } else {
        scanCircleRef.current.setLatLng([scan.center.lat, scan.center.lng])
        scanCircleRef.current.setRadius(radiusM)
      }
    } else if (scanCircleRef.current) {
      map.removeLayer(scanCircleRef.current)
      scanCircleRef.current = null
    }
  }, [truck, scan])

  return (
    <div
      ref={mapEl}
      className="h-72 w-full overflow-hidden rounded-md border border-border bg-muted/30"
    />
  )
}
