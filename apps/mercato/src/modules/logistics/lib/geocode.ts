import { createLogger } from '@open-mercato/shared/lib/logger'
import type { FreightLane } from './agreed-offer'

const logger = createLogger('logistics').child({ component: 'geocode' })

const NOMINATIM_URL = process.env.LOGISTICS_GEOCODER_URL || 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = process.env.LOGISTICS_GEOCODER_USER_AGENT || 'open-logistic-demo/1.0 (dispatcher map)'
const TIMEOUT_MS = 4_000

type GeocodedPlace = FreightLane['from']

/**
 * Process-wide cache. A demo replays the same lanes over and over and
 * Nominatim's usage policy is one call per second, so the same address is
 * never asked twice. A miss is cached as null too.
 */
const cache = new Map<string, GeocodedPlace | null>()

type NominatimHit = {
  lat?: string
  lon?: string
  display_name?: string
  address?: Record<string, string>
}

function localityOf(address: Record<string, string> | undefined, fallback: string): string {
  const candidate =
    address?.city || address?.town || address?.village || address?.municipality || address?.county
  return candidate?.trim() || fallback
}

/**
 * Turns a free-text address from an email into map coordinates.
 *
 * Returns null on anything unexpected — no hit, a timeout, an offline box —
 * so the caller keeps its own fallback rather than drawing a wrong pin.
 */
export async function geocodeAddress(address: string): Promise<GeocodedPlace | null> {
  const query = address.trim()
  if (!query) return null
  const cached = cache.get(query)
  if (cached !== undefined) return cached

  try {
    const url = `${NOMINATIM_URL}?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(query)}`
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'pl,en' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`geocoder HTTP ${response.status}`)
    const hits = (await response.json()) as NominatimHit[]
    const hit = hits?.[0]
    const lat = Number.parseFloat(hit?.lat ?? '')
    const lng = Number.parseFloat(hit?.lon ?? '')
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      cache.set(query, null)
      return null
    }
    const place: GeocodedPlace = {
      name: query,
      locality: localityOf(hit?.address, query),
      country: (hit?.address?.country_code || 'PL').toUpperCase(),
      lat,
      lng,
    }
    cache.set(query, place)
    return place
  } catch (error) {
    logger.warn('Geocoding failed, keeping the demo fallback lane', { address: query, error })
    cache.set(query, null)
    return null
  }
}
