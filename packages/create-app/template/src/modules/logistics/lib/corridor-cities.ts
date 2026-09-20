/**
 * The city table the backload scan names its hits after.
 *
 * The scan samples the GraphHopper polyline every 55 km, which yields a point
 * in a field as often as a point in a town. Labelling that point `Doładunek@443km`
 * told the dispatcher nothing they could act on. Snapping it to the nearest real
 * city does, and it stays offline and deterministic, unlike a reverse-geocoder
 * call per sample against Nominatim's one-request-per-second policy.
 *
 * Coverage is the Poland-to-western-Europe corridor the demo drives. A point
 * further than `MAX_SNAP_KM` from every entry keeps a plain coordinate label,
 * because naming it after a city 200 km away would be a lie on the screen.
 */

export type CorridorCity = { name: string; country: string; lat: number; lng: number }

export const CORRIDOR_CITIES: CorridorCity[] = [
  { name: 'Gdańsk', country: 'PL', lat: 54.352, lng: 18.6466 },
  { name: 'Gdynia', country: 'PL', lat: 54.5189, lng: 18.5305 },
  { name: 'Elbląg', country: 'PL', lat: 54.1522, lng: 19.4088 },
  { name: 'Olsztyn', country: 'PL', lat: 53.7784, lng: 20.4801 },
  { name: 'Bydgoszcz', country: 'PL', lat: 53.1235, lng: 18.0084 },
  { name: 'Toruń', country: 'PL', lat: 53.0138, lng: 18.5984 },
  { name: 'Szczecin', country: 'PL', lat: 53.4285, lng: 14.5528 },
  { name: 'Gorzów Wielkopolski', country: 'PL', lat: 52.7368, lng: 15.2288 },
  { name: 'Piła', country: 'PL', lat: 53.1515, lng: 16.7379 },
  { name: 'Poznań', country: 'PL', lat: 52.4064, lng: 16.9252 },
  { name: 'Konin', country: 'PL', lat: 52.2231, lng: 18.2512 },
  { name: 'Włocławek', country: 'PL', lat: 52.6483, lng: 19.068 },
  { name: 'Płock', country: 'PL', lat: 52.5468, lng: 19.7064 },
  { name: 'Warszawa', country: 'PL', lat: 52.2297, lng: 21.0122 },
  { name: 'Łódź', country: 'PL', lat: 51.7592, lng: 19.4559 },
  { name: 'Kalisz', country: 'PL', lat: 51.7611, lng: 18.091 },
  { name: 'Zielona Góra', country: 'PL', lat: 51.9356, lng: 15.5062 },
  { name: 'Legnica', country: 'PL', lat: 51.2070, lng: 16.1553 },
  { name: 'Wrocław', country: 'PL', lat: 51.1079, lng: 17.0385 },
  { name: 'Opole', country: 'PL', lat: 50.6751, lng: 17.9213 },
  { name: 'Częstochowa', country: 'PL', lat: 50.8118, lng: 19.1203 },
  { name: 'Katowice', country: 'PL', lat: 50.2649, lng: 19.0238 },
  { name: 'Kraków', country: 'PL', lat: 50.0647, lng: 19.945 },
  { name: 'Rzeszów', country: 'PL', lat: 50.0413, lng: 21.999 },
  { name: 'Lublin', country: 'PL', lat: 51.2465, lng: 22.5684 },
  { name: 'Białystok', country: 'PL', lat: 53.1325, lng: 23.1688 },
  { name: 'Berlin', country: 'DE', lat: 52.52, lng: 13.405 },
  { name: 'Frankfurt (Oder)', country: 'DE', lat: 52.3412, lng: 14.5506 },
  { name: 'Cottbus', country: 'DE', lat: 51.7563, lng: 14.3329 },
  { name: 'Dresden', country: 'DE', lat: 51.0504, lng: 13.7373 },
  { name: 'Leipzig', country: 'DE', lat: 51.3397, lng: 12.3731 },
  { name: 'Magdeburg', country: 'DE', lat: 52.1205, lng: 11.6276 },
  { name: 'Hannover', country: 'DE', lat: 52.3759, lng: 9.732 },
  { name: 'Hamburg', country: 'DE', lat: 53.5511, lng: 9.9937 },
  { name: 'Szczecin Port', country: 'PL', lat: 53.4, lng: 14.6 },
  { name: 'Praha', country: 'CZ', lat: 50.0755, lng: 14.4378 },
  { name: 'Brno', country: 'CZ', lat: 49.1951, lng: 16.6068 },
  { name: 'Ostrava', country: 'CZ', lat: 49.8209, lng: 18.2625 },
  { name: 'Wien', country: 'AT', lat: 48.2082, lng: 16.3738 },
  { name: 'Bratislava', country: 'SK', lat: 48.1486, lng: 17.1077 },
]

/** How far a sampled point may sit from a city and still take its name. */
export const MAX_SNAP_KM = 45

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (value: number) => (value * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Comparable form of a place name: no diacritics, no country suffix, no case. */
export function samePlace(left: string | undefined, right: string | undefined): boolean {
  const normalize = (value: string | undefined) =>
    (value ?? '')
      .replace(/\s*\([A-Z]{2}\)\s*$/i, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase()
  const a = normalize(left)
  const b = normalize(right)
  return a.length > 0 && a === b
}

/**
 * Nearest city within MAX_SNAP_KM, or null when the point is out in the open.
 *
 * `avoid` skips a city the caller already used for the other end of the load.
 * Without it a sample close to the destination snapped to the destination city
 * and the dispatcher read "Wrocław → Wrocław", which is not a backload.
 */
export function nearestCity(
  point: { lat: number; lng: number },
  avoid?: string,
): CorridorCity | null {
  let best: { city: CorridorCity; km: number } | null = null
  for (const city of CORRIDOR_CITIES) {
    if (avoid && samePlace(city.name, avoid)) continue
    const km = haversineKm(point, city)
    if (!best || km < best.km) best = { city, km }
  }
  return best && best.km <= MAX_SNAP_KM ? best.city : null
}

/**
 * The label a backload point carries on screen: a city when one is close
 * enough, and a coordinate pair when none is.
 */
export function placeLabel(
  point: { lat: number; lng: number },
  fallback: string,
  avoid?: string,
): string {
  const city = nearestCity(point, avoid)
  return city ? `${city.name} (${city.country})` : fallback
}
