/**
 * Tiny gazetteer for the dispatcher map. Sales-backed transports store only free-text
 * addresses, so pins are placed by matching a known city name inside the address.
 * Covers the demo seed cities plus the main PL/DE/CZ/AT hubs; unknown addresses get no pin.
 */
export type LatLng = { lat: number; lng: number }

const CITIES: Array<{ names: string[]; lat: number; lng: number }> = [
  { names: ['Warszawa', 'Warsaw'], lat: 52.2297, lng: 21.0122 },
  { names: ['Kraków', 'Krakow', 'Cracow'], lat: 50.0647, lng: 19.945 },
  { names: ['Łódź', 'Lodz'], lat: 51.7592, lng: 19.456 },
  { names: ['Wrocław', 'Wroclaw'], lat: 51.1079, lng: 17.0385 },
  { names: ['Poznań', 'Poznan'], lat: 52.4064, lng: 16.9252 },
  { names: ['Gdańsk', 'Gdansk'], lat: 54.352, lng: 18.6466 },
  { names: ['Gdynia'], lat: 54.5189, lng: 18.5305 },
  { names: ['Szczecin'], lat: 53.4285, lng: 14.5528 },
  { names: ['Bydgoszcz'], lat: 53.1235, lng: 18.0084 },
  { names: ['Lublin'], lat: 51.2465, lng: 22.5684 },
  { names: ['Katowice'], lat: 50.2649, lng: 19.0238 },
  { names: ['Białystok', 'Bialystok'], lat: 53.1325, lng: 23.1688 },
  { names: ['Rzeszów', 'Rzeszow'], lat: 50.0412, lng: 21.9991 },
  { names: ['Toruń', 'Torun'], lat: 53.0138, lng: 18.5984 },
  { names: ['Opole'], lat: 50.6751, lng: 17.9213 },
  { names: ['Zielona Góra', 'Zielona Gora'], lat: 51.9356, lng: 15.5062 },
  { names: ['Konin'], lat: 52.223, lng: 18.251 },
  { names: ['Olsztyn'], lat: 53.7784, lng: 20.4801 },
  { names: ['Kielce'], lat: 50.8661, lng: 20.6286 },
  { names: ['Berlin'], lat: 52.52, lng: 13.405 },
  { names: ['Hamburg'], lat: 53.5511, lng: 9.9937 },
  { names: ['München', 'Munchen', 'Munich'], lat: 48.1351, lng: 11.582 },
  { names: ['Dresden', 'Drezno'], lat: 51.0504, lng: 13.7373 },
  { names: ['Frankfurt'], lat: 50.1109, lng: 8.6821 },
  { names: ['Praha', 'Prague', 'Praga'], lat: 50.0755, lng: 14.4378 },
  { names: ['Brno'], lat: 49.1951, lng: 16.6068 },
  { names: ['Wien', 'Vienna', 'Wiedeń', 'Wieden'], lat: 48.2082, lng: 16.3738 },
  { names: ['Bratislava', 'Bratysława'], lat: 48.1486, lng: 17.1077 },
  { names: ['Vilnius', 'Wilno'], lat: 54.6872, lng: 25.2797 },
  { names: ['Amsterdam'], lat: 52.3676, lng: 4.9041 },
  { names: ['Rotterdam'], lat: 51.9244, lng: 4.4777 },
]

/** Poland's centroid — default map center and the search origin for "all vehicles". */
export const MAP_CENTER: LatLng = { lat: 52.0, lng: 19.4 }

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase()
}

const INDEX = CITIES.flatMap((city) => city.names.map((name) => ({ key: normalize(name), lat: city.lat, lng: city.lng })))
  // Longest names first so "Zielona Góra" wins over a shorter accidental match.
  .sort((a, b) => b.key.length - a.key.length)

/** Returns coordinates of the first known city mentioned in a free-text address, or null. */
export function resolveCityCoords(address: string | null | undefined): LatLng | null {
  if (!address) return null
  const haystack = normalize(address)
  for (const entry of INDEX) {
    const at = haystack.indexOf(entry.key)
    if (at === -1) continue
    const before = at === 0 ? ' ' : haystack[at - 1]
    const after = haystack[at + entry.key.length] ?? ' '
    // Whole-word match only, so "Konin" does not fire inside "Koninko".
    if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue
    return { lat: entry.lat, lng: entry.lng }
  }
  return null
}
