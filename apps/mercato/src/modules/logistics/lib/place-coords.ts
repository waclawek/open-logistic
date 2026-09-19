/** Demo geocode table for dispatcher origin/destination labels → GraphHopper points. */

export type PlacePoint = {
  name: string
  locality: string
  country: string
  lat: number
  lng: number
}

const PLACES: Record<string, PlacePoint> = {
  warszawa: { name: 'Warszawa', locality: 'Warszawa', country: 'PL', lat: 52.2297, lng: 21.0122 },
  warsaw: { name: 'Warszawa', locality: 'Warszawa', country: 'PL', lat: 52.2297, lng: 21.0122 },
  łódź: { name: 'Łódź', locality: 'Łódź', country: 'PL', lat: 51.7592, lng: 19.456 },
  lodz: { name: 'Łódź', locality: 'Łódź', country: 'PL', lat: 51.7592, lng: 19.456 },
  kraków: { name: 'Kraków', locality: 'Kraków', country: 'PL', lat: 50.0647, lng: 19.945 },
  krakow: { name: 'Kraków', locality: 'Kraków', country: 'PL', lat: 50.0647, lng: 19.945 },
  poznań: { name: 'Poznań', locality: 'Poznań', country: 'PL', lat: 52.4064, lng: 16.9252 },
  poznan: { name: 'Poznań', locality: 'Poznań', country: 'PL', lat: 52.4064, lng: 16.9252 },
  gdańsk: { name: 'Gdańsk', locality: 'Gdańsk', country: 'PL', lat: 54.352, lng: 18.6466 },
  gdansk: { name: 'Gdańsk', locality: 'Gdańsk', country: 'PL', lat: 54.352, lng: 18.6466 },
  wrocław: { name: 'Wrocław', locality: 'Wrocław', country: 'PL', lat: 51.1079, lng: 17.0385 },
  wroclaw: { name: 'Wrocław', locality: 'Wrocław', country: 'PL', lat: 51.1079, lng: 17.0385 },
  berlin: { name: 'Berlin', locality: 'Berlin', country: 'DE', lat: 52.52, lng: 13.405 },
  hamburg: { name: 'Hamburg', locality: 'Hamburg', country: 'DE', lat: 53.5511, lng: 9.9937 },
  wien: { name: 'Wien', locality: 'Wien', country: 'AT', lat: 48.2082, lng: 16.3738 },
  vienna: { name: 'Wien', locality: 'Wien', country: 'AT', lat: 48.2082, lng: 16.3738 },
  praha: { name: 'Praha', locality: 'Praha', country: 'CZ', lat: 50.0755, lng: 14.4378 },
  prague: { name: 'Praha', locality: 'Praha', country: 'CZ', lat: 50.0755, lng: 14.4378 },
  bydgoszcz: { name: 'Bydgoszcz', locality: 'Bydgoszcz', country: 'PL', lat: 53.1235, lng: 18.0084 },
  kielce: { name: 'Kielce', locality: 'Kielce', country: 'PL', lat: 50.8661, lng: 20.6286 },
  szczecin: { name: 'Szczecin', locality: 'Szczecin', country: 'PL', lat: 53.4285, lng: 14.5528 },
  lublin: { name: 'Lublin', locality: 'Lublin', country: 'PL', lat: 51.2465, lng: 22.5684 },
  katowice: { name: 'Katowice', locality: 'Katowice', country: 'PL', lat: 50.2649, lng: 19.0238 },
  opole: { name: 'Opole', locality: 'Opole', country: 'PL', lat: 50.6751, lng: 17.9213 },
  białystok: { name: 'Białystok', locality: 'Białystok', country: 'PL', lat: 53.1325, lng: 23.1688 },
  bialystok: { name: 'Białystok', locality: 'Białystok', country: 'PL', lat: 53.1325, lng: 23.1688 },
  rzeszów: { name: 'Rzeszów', locality: 'Rzeszów', country: 'PL', lat: 50.0412, lng: 21.9991 },
  rzeszow: { name: 'Rzeszów', locality: 'Rzeszów', country: 'PL', lat: 50.0412, lng: 21.9991 },
  toruń: { name: 'Toruń', locality: 'Toruń', country: 'PL', lat: 53.0138, lng: 18.5984 },
  torun: { name: 'Toruń', locality: 'Toruń', country: 'PL', lat: 53.0138, lng: 18.5984 },
  'zielona góra': { name: 'Zielona Góra', locality: 'Zielona Góra', country: 'PL', lat: 51.9356, lng: 15.5062 },
  'zielona gora': { name: 'Zielona Góra', locality: 'Zielona Góra', country: 'PL', lat: 51.9356, lng: 15.5062 },
}

function normalizeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
}

/** Resolve a free-text city/place label used by dispatcher transports/offers. */
export function resolvePlace(label: string): PlacePoint {
  const raw = label.trim()
  const direct = PLACES[raw.toLowerCase()] ?? PLACES[normalizeLabel(raw)]
  if (direct) return { ...direct }
  // Fallback: keep the label, pin near Poland centroid so GraphHopper still gets a point.
  return {
    name: raw || 'Unknown',
    locality: raw || 'Unknown',
    country: 'PL',
    lat: 52.0,
    lng: 19.0,
  }
}
