import {
  CITIES,
  externalId,
  floatBetween,
  GenCtx,
  intBetween,
  isoDaysFromNow,
  pick,
  rng,
} from './common'

function place(city: (typeof CITIES)[number], rand: () => number) {
  return {
    address: {
      country: city.country,
      locality: city.name,
      postal_code: city.postal,
      street: pick(rand, ['Industrialna', 'Logistyczna', 'Spedycyjna', 'Hauptstrasse']),
      number: String(intBetween(rand, 1, 120)),
    },
    coordinates: {
      latitude: city.lat + floatBetween(rand, -0.05, 0.05, 5),
      longitude: city.lon + floatBetween(rand, -0.05, 0.05, 5),
    },
  }
}

function spot(
  city: (typeof CITIES)[number],
  order: number,
  type: 'loading' | 'unloading',
  rand: () => number,
) {
  const begin = isoDaysFromNow(rand, type === 'loading' ? 1 : 2, type === 'loading' ? 3 : 6)
  const end = new Date(new Date(begin).getTime() + intBetween(rand, 4, 24) * 3_600_000).toISOString()
  return {
    name: `${type === 'loading' ? 'Loading' : 'Unloading'} ${city.name}`,
    spot_order: order,
    place: place(city, rand),
    operations: [
      {
        type,
        operation_order: 1,
        operation_time: intBetween(rand, 30, 180),
        timespans: { begin, end, timezone: 'Europe/Warsaw' },
        loads: [{ load_id: '1' }],
      },
    ],
  }
}

export function freightCreatePublic(ctx: GenCtx) {
  const rand = rng(ctx)
  const origin = pick(rand, [...CITIES.filter((c) => c.country === 'pl')])
  const destPool = CITIES.filter((c) => c.name !== origin.name)
  const dest = pick(rand, [...destPool])
  const weight = floatBetween(rand, 8, 24, 1)
  const price = floatBetween(rand, 400, 2200, 2)
  const currency = String(ctx.vars?.currency ?? 'eur')

  return {
    is_roundtrip: false,
    capacity: 1,
    loading_meters: floatBetween(rand, 4, 13.6, 1),
    weight,
    volume: floatBetween(rand, 20, 80, 1),
    height: floatBetween(rand, 2, 3, 2),
    width: 2.4,
    length: floatBetween(rand, 6, 13.6, 1),
    transit_time: intBetween(rand, 12, 72),
    distance: intBetween(rand, 200, 1200),
    publish: true,
    publish_date: new Date().toISOString(),
    decision_date: isoDaysFromNow(rand, 0, 1),
    finish_date: isoDaysFromNow(rand, 3, 8),
    shipment_external_id: externalId(ctx, 'FR'),
    external_source: 'open-mercato-trans-sim',
    contact_employees: (ctx.vars?.contactEmployees as string[]) ?? ['105-1'],
    loads: [
      {
        load_id: '1',
        name: pick(rand, ['Pallets', 'Steel coils', 'FMCG', 'Electronics']),
        type_of_load: 'ftl',
        weight,
        amount: intBetween(rand, 10, 33),
        is_stackable: rand() > 0.5,
        is_exchangeable: false,
      },
    ],
    payment: {
      price: {
        type: 'km',
        value: price,
        currency,
        period: { payment: 'deferred', days: 30 },
      },
    },
    publication_price: { currency, value: price },
    requirements: {
      vehicle_size: pick(rand, ['any_size', 'truck', 'lorry']),
      vehicle_types: ['curtainsider'],
      required: ['tracking'],
    },
    spots: [spot(origin, 1, 'loading', rand), spot(dest, 2, 'unloading', rand)],
  }
}

export function freightCreateCompanies(ctx: GenCtx) {
  return {
    ...freightCreatePublic(ctx),
    publish: 'companies',
    carriers: [{ company_id: Number(ctx.vars?.carrierCompanyId ?? 1028504) }],
  }
}

export function freightOfferAccept(ctx: GenCtx) {
  return {
    offer_id: ctx.vars?.offerId ?? externalId(ctx, 'OFF'),
    price: {
      currency: String(ctx.vars?.currency ?? 'eur'),
      value: floatBetween(rng(ctx), 500, 1800, 2),
    },
  }
}

export function freightEntityEvent(ctx: GenCtx) {
  const body = freightCreatePublic(ctx)
  return {
    event: 'freight.created',
    occurred_at: new Date().toISOString(),
    source: 'trans.eu',
    freight_id: intBetween(rng(ctx), 1_000_000, 9_999_999),
    payload: body,
  }
}
