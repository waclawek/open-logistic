import { searchBackloadsAlongRoute } from '../lib/exchange'
import type { LogisticsRoute } from '../lib/types'

function straightRoute(pointCount: number): LogisticsRoute {
  const coordinates: [number, number][] = Array.from({ length: pointCount }, (_, index) => [
    14 + index * 0.4,
    52 + index * 0.1,
  ])
  return {
    source: 'test',
    distanceM: 600_000,
    durationMs: 21_600_000,
    from: { name: 'Warszawa', lat: 52, lng: 14 },
    to: {
      name: 'Berlin',
      lat: coordinates[coordinates.length - 1]![1],
      lng: coordinates[coordinates.length - 1]![0],
    },
    points: { type: 'LineString', coordinates },
  } as unknown as LogisticsRoute
}

function freightsAhead(fromAlongKm: number, route: LogisticsRoute) {
  const result = searchBackloadsAlongRoute({ route, fromAlongKm, radiusKm: 45, maxResults: 20 })
  return result.candidates.filter(
    (candidate) =>
      candidate.kind === 'freight' &&
      candidate.alongRouteKm >= fromAlongKm &&
      candidate.economics.fitsFreeCapacity,
  )
}

test('a scan from the start of the route still offers freight the truck can take', () => {
  expect(freightsAhead(0, straightRoute(40)).length).toBeGreaterThan(0)
})

test('a scan near the end of the route still offers one workable backload', () => {
  const route = straightRoute(40)
  const almostThere = (route.distanceM ?? 0) / 1000 - 5
  const ahead = freightsAhead(almostThere, route)
  expect(ahead.length).toBeGreaterThan(0)
  expect(ahead[0]!.weightT).toBeLessThanOrEqual(ahead[0]!.economics.freeWeightT)
})

test('a two-point route, where the sampled grid yields nothing, still offers one', () => {
  expect(freightsAhead(0, straightRoute(2)).length).toBeGreaterThan(0)
})
