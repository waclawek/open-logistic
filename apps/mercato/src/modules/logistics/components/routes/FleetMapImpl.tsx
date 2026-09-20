'use client'

import { useEffect, useRef } from 'react'
import * as L from 'leaflet'
import type { FleetMapImplProps } from './FleetMap'

const leaflet = ((L as { default?: typeof L }).default ?? L) as typeof L

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

// Marker colours match the existing transport-run map (truck amber, pickup green, delivery red).
const COLOR_TRUCK = '#f59e0b'
const COLOR_PICKUP = '#16a34a'
const COLOR_DELIVERY = '#dc2626'

/** Free vehicles as amber dots, transport pickup/delivery as green/red dots; selected transport is bigger and gets a dashed link. */
export default function FleetMapImpl({ center, vehicles, pins, selectedTransportId }: FleetMapImplProps) {
  const mapEl = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const vehiclesLayer = useRef<L.LayerGroup | null>(null)
  const pinsLayer = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    const node = mapEl.current
    if (!node || mapRef.current) return undefined
    const map = leaflet.map(node, { center: [center.lat, center.lng], zoom: 6, scrollWheelZoom: false })
    leaflet.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map)
    mapRef.current = map
    const resizeObserver = new ResizeObserver(() => map.invalidateSize())
    resizeObserver.observe(node)
    requestAnimationFrame(() => map.invalidateSize())
    return () => {
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
      vehiclesLayer.current = null
      pinsLayer.current = null
    }
    // center is only the initial view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (vehiclesLayer.current) map.removeLayer(vehiclesLayer.current)
    vehiclesLayer.current = leaflet.layerGroup(
      vehicles.map((vehicle) => leaflet
        .circleMarker([vehicle.position.lat, vehicle.position.lng], { radius: 8, color: COLOR_TRUCK, fillColor: COLOR_TRUCK, fillOpacity: 0.9, weight: 2 })
        .bindTooltip(`${vehicle.label}<br/><span style="opacity:.7">${vehicle.detail}</span>`, { direction: 'top' })),
    ).addTo(map)
  }, [vehicles])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (pinsLayer.current) map.removeLayer(pinsLayer.current)
    const layers: L.Layer[] = pins.map((pin) => {
      const color = pin.kind === 'pickup' ? COLOR_PICKUP : COLOR_DELIVERY
      return leaflet
        .circleMarker([pin.position.lat, pin.position.lng], {
          radius: pin.highlighted ? 9 : 5,
          color,
          fillColor: color,
          fillOpacity: pin.highlighted ? 1 : 0.6,
          weight: pin.highlighted ? 3 : 1,
        })
        .bindTooltip(pin.label, { direction: 'top' })
    })
    if (selectedTransportId) {
      const pickup = pins.find((pin) => pin.id === `${selectedTransportId}:pickup`)
      const delivery = pins.find((pin) => pin.id === `${selectedTransportId}:delivery`)
      if (pickup && delivery) {
        layers.push(leaflet.polyline(
          [[pickup.position.lat, pickup.position.lng], [delivery.position.lat, delivery.position.lng]],
          { color: '#2563eb', weight: 3, dashArray: '6 6', opacity: 0.8 },
        ))
        map.fitBounds(leaflet.latLngBounds([pickup.position, delivery.position]), { padding: [40, 40], maxZoom: 7 })
      }
    }
    pinsLayer.current = leaflet.layerGroup(layers).addTo(map)
  }, [pins, selectedTransportId])

  return <div ref={mapEl} className="absolute inset-0" data-testid="fleet-map-canvas" />
}
