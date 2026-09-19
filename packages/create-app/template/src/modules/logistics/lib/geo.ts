/**
 * Minimal geo helpers for the logistics demo.
 *
 * Open Mercato ships no routing engine, so distances are computed from a small
 * built-in city gazetteer with the haversine formula and a road factor. This is
 * an explicit demo assumption; a production build would call OSRM/Google.
 */
export type GeoPoint = { lat: number; lng: number }

const CITY_COORDS: Record<string, GeoPoint> = {
  wroclaw: { lat: 51.1079, lng: 17.0385 },
  berlin: { lat: 52.52, lng: 13.405 },
  hamburg: { lat: 53.5511, lng: 9.9937 },
  praha: { lat: 50.0755, lng: 14.4378 },
  praga: { lat: 50.0755, lng: 14.4378 },
  prague: { lat: 50.0755, lng: 14.4378 },
  gdansk: { lat: 54.352, lng: 18.6466 },
  poznan: { lat: 52.4064, lng: 16.9252 },
  warszawa: { lat: 52.2297, lng: 21.0122 },
  warsaw: { lat: 52.2297, lng: 21.0122 },
  krakow: { lat: 50.0647, lng: 19.945 },
  lodz: { lat: 51.7592, lng: 19.456 },
  katowice: { lat: 50.2649, lng: 19.0238 },
  szczecin: { lat: 53.4285, lng: 14.5528 },
  lublin: { lat: 51.2465, lng: 22.5684 },
  bydgoszcz: { lat: 53.1235, lng: 18.0084 },
  rzeszow: { lat: 50.0412, lng: 21.9991 },
  bialystok: { lat: 53.1325, lng: 23.1688 },
  opole: { lat: 50.6751, lng: 17.9213 },
  torun: { lat: 53.0138, lng: 18.5984 },
  kielce: { lat: 50.8661, lng: 20.6286 },
  olsztyn: { lat: 53.7784, lng: 20.4801 },
  'zielona gora': { lat: 51.9356, lng: 15.5062 },
  'gorzow wielkopolski': { lat: 52.7368, lng: 15.2288 },
  dresden: { lat: 51.0504, lng: 13.7373 },
  drezno: { lat: 51.0504, lng: 13.7373 },
  leipzig: { lat: 51.3397, lng: 12.3731 },
  lipsk: { lat: 51.3397, lng: 12.3731 },
  munchen: { lat: 48.1351, lng: 11.582 },
  monachium: { lat: 48.1351, lng: 11.582 },
  frankfurt: { lat: 50.1109, lng: 8.6821 },
  hannover: { lat: 52.3759, lng: 9.732 },
  bremen: { lat: 53.0793, lng: 8.8017 },
  koln: { lat: 50.9375, lng: 6.9603 },
  dusseldorf: { lat: 51.2277, lng: 6.7735 },
  stuttgart: { lat: 48.7758, lng: 9.1829 },
  nurnberg: { lat: 49.4521, lng: 11.0767 },
  wien: { lat: 48.2082, lng: 16.3738 },
  wieden: { lat: 48.2082, lng: 16.3738 },
  bratislava: { lat: 48.1486, lng: 17.1077 },
  brno: { lat: 49.1951, lng: 16.6068 },
  ostrava: { lat: 49.8209, lng: 18.2625 },
  budapest: { lat: 47.4979, lng: 19.0402 },
  amsterdam: { lat: 52.3676, lng: 4.9041 },
  rotterdam: { lat: 51.9244, lng: 4.4777 },
  antwerpen: { lat: 51.2194, lng: 4.4025 },
  brussel: { lat: 50.8503, lng: 4.3517 },
  paris: { lat: 48.8566, lng: 2.3522 },
  paryz: { lat: 48.8566, lng: 2.3522 },
  milano: { lat: 45.4642, lng: 9.19 },
  mediolan: { lat: 45.4642, lng: 9.19 },
  vilnius: { lat: 54.6872, lng: 25.2797 },
  wilno: { lat: 54.6872, lng: 25.2797 },
  kaunas: { lat: 54.8985, lng: 23.9036 },
  kobenhavn: { lat: 55.6761, lng: 12.5683 },
  kopenhaga: { lat: 55.6761, lng: 12.5683 },
}

/** Average speed used to turn kilometres into driving hours (incl. breaks). */
export const AVERAGE_SPEED_KMH = 65
/** Straight-line → road distance multiplier for Central Europe. */
export const ROAD_FACTOR = 1.25

export function normalizeCity(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/ß/g, 'ss')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ä/g, 'a')
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Pull a city name out of a free-text address such as
 * "ul. Fabryczna 12, 54-010 Wrocław" or "Am Sandtorkai 40, 20457 Hamburg".
 */
export function extractCity(address: string): string {
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean)
  const candidates = parts.length ? [parts[parts.length - 1]!, ...parts.slice(0, -1).reverse()] : [address]
  for (const candidate of candidates) {
    const withoutPostal = candidate.replace(/\b\d{2}-\d{3}\b/g, '').replace(/\b\d{4,6}\b/g, '').trim()
    const normalized = normalizeCity(withoutPostal)
    if (normalized && CITY_COORDS[normalized]) return normalized
    // Try each word (handles "110 00 Praha 1")
    for (const word of normalized.split(' ')) {
      if (CITY_COORDS[word]) return word
    }
  }
  return normalizeCity(parts[parts.length - 1] ?? address)
}

export function resolvePoint(addressOrCity: string): { city: string; point: GeoPoint } | null {
  const city = extractCity(addressOrCity)
  const point = CITY_COORDS[city]
  return point ? { city, point } : null
}

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

export type RouteEstimate = {
  fromCity: string
  toCity: string
  distanceKm: number
  driveHours: number
  known: boolean
}

export function displayCity(city: string): string {
  return city.replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Road distance between two addresses/cities. Unknown cities fall back to a
 * conservative 500 km and are flagged with `known: false` so the agent can say so.
 */
export function estimateRoute(from: string, to: string): RouteEstimate {
  const a = resolvePoint(from)
  const b = resolvePoint(to)
  if (!a || !b) {
    return {
      fromCity: a?.city ?? extractCity(from),
      toCity: b?.city ?? extractCity(to),
      distanceKm: 500,
      driveHours: Math.round((500 / AVERAGE_SPEED_KMH) * 10) / 10,
      known: false,
    }
  }
  const distanceKm = Math.round(haversineKm(a.point, b.point) * ROAD_FACTOR)
  return {
    fromCity: a.city,
    toCity: b.city,
    distanceKm,
    driveHours: Math.round((distanceKm / AVERAGE_SPEED_KMH) * 10) / 10,
    known: true,
  }
}
