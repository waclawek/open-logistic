import fs from 'node:fs'
import path from 'node:path'
import type { LatLng, LogisticsRoute } from './types'

type GhPath = {
  distance: number
  time: number
  points: { type: string; coordinates: [number, number][] }
  instructions?: Array<{
    text?: string
    distance?: number
    time?: number
    sign?: number
    street_name?: string
  }>
}

type FixtureFile = {
  meta: {
    from: { name: string; lat: number; lng: number }
    to: { name: string; lat: number; lng: number }
    profile: string
    provider: string
  }
  distance_m: number
  time_ms: number
  points: { type: string; coordinates: [number, number][] }
  instructions: Array<{
    text?: string
    distance_m?: number
    time_ms?: number
    sign?: number
    street_name?: string
  }>
}

function resolveFixturePath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'tools/graphhopper-demo/fixtures/waw-poz.route.json'),
    path.resolve(process.cwd(), '../tools/graphhopper-demo/fixtures/waw-poz.route.json'),
    path.resolve(process.cwd(), '../../tools/graphhopper-demo/fixtures/waw-poz.route.json'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error('[internal] GraphHopper WAW→POZ fixture not found')
}

function loadFixture(): LogisticsRoute {
  const raw = JSON.parse(fs.readFileSync(resolveFixturePath(), 'utf8')) as FixtureFile
  return {
    provider: 'graphhopper',
    source: 'fixture',
    profile: raw.meta.profile || 'car',
    distanceM: raw.distance_m,
    timeMs: raw.time_ms,
    points: {
      type: 'LineString',
      coordinates: raw.points.coordinates as [number, number][],
    },
    instructions: (raw.instructions || []).map((i) => ({
      text: i.text || '',
      distanceM: i.distance_m || 0,
      timeMs: i.time_ms || 0,
      sign: i.sign,
      streetName: i.street_name,
    })),
    from: { name: raw.meta.from.name, lat: raw.meta.from.lat, lng: raw.meta.from.lng },
    to: { name: raw.meta.to.name, lat: raw.meta.to.lat, lng: raw.meta.to.lng },
  }
}

function isWawPoz(from: LatLng, to: LatLng): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.05
  return (
    near(from.lat, 52.2297) &&
    near(from.lng, 21.0122) &&
    near(to.lat, 52.4064) &&
    near(to.lng, 16.9252)
  )
}

function haversineM(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const r = 6_371_000
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Offline fallback for any lane when live GraphHopper is down. */
function synthesizeCorridor(from: LatLng, to: LatLng, steps = 48): LogisticsRoute {
  const coordinates: [number, number][] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    coordinates.push([from.lng + (to.lng - from.lng) * t, from.lat + (to.lat - from.lat) * t])
  }
  const distanceM = Math.round(haversineM(from, to) * 1.18)
  const timeMs = Math.round((distanceM / 18) * 1000)
  return {
    provider: 'graphhopper',
    source: 'synthetic',
    profile: 'car',
    distanceM,
    timeMs,
    points: { type: 'LineString', coordinates },
    instructions: [
      { text: `Head toward ${to.name || 'destination'} (offline straight-line — start GraphHopper for road geometry)`, distanceM, timeMs },
    ],
    from: { ...from },
    to: { ...to },
  }
}

export async function planRoute(from: LatLng, to: LatLng): Promise<LogisticsRoute> {
  const base = (process.env.GRAPHHOPPER_URL || 'http://127.0.0.1:8989').replace(/\/$/, '')
  const url =
    `${base}/route?point=${from.lat},${from.lng}&point=${to.lat},${to.lng}` +
    `&profile=car&locale=pl&points_encoded=false&instructions=true`

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
    if (!res.ok) throw new Error(`GraphHopper HTTP ${res.status}`)
    const data = (await res.json()) as { paths?: GhPath[]; message?: string }
    const path0 = data.paths?.[0]
    if (!path0?.points?.coordinates?.length) {
      throw new Error(data.message || 'empty GraphHopper path')
    }
    return {
      provider: 'graphhopper',
      source: 'live',
      profile: 'car',
      distanceM: Math.round(path0.distance),
      timeMs: path0.time,
      points: {
        type: 'LineString',
        coordinates: path0.points.coordinates as [number, number][],
      },
      instructions: (path0.instructions || []).map((i) => ({
        text: i.text || '',
        distanceM: Math.round(i.distance || 0),
        timeMs: i.time || 0,
        sign: i.sign,
        streetName: i.street_name,
      })),
      from: { ...from },
      to: { ...to },
    }
  } catch {
    if (isWawPoz(from, to)) {
      const fixture = loadFixture()
      return {
        ...fixture,
        from: { ...from, name: from.name || fixture.from.name },
        to: { ...to, name: to.name || fixture.to.name },
      }
    }
    return synthesizeCorridor(from, to)
  }
}
