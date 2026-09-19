import { z } from 'zod'
import { orderPayloadSchema, type OrderPayload } from '@open-mercato/core/modules/inbox_ops/data/validators'

/**
 * Agreed client offer = accepted sales quote payload (same contract as
 * offer_automation `draft_offer` / core `orderPayloadSchema`) plus lane
 * geometry the logistics agents need for GraphHopper + exchange search.
 */
export const freightLaneSchema = z.object({
  from: z.object({
    name: z.string(),
    locality: z.string(),
    country: z.string().length(2),
    lat: z.number(),
    lng: z.number(),
  }),
  to: z.object({
    name: z.string(),
    locality: z.string(),
    country: z.string().length(2),
    lat: z.number(),
    lng: z.number(),
  }),
  weightT: z.number().positive(),
  ldm: z.number().positive().optional(),
  pallets: z.number().int().positive().optional(),
  /** Locality used for free-vehicle search along the corridor */
  searchLocality: z.string().optional(),
})

export const agreedClientOfferSchema = orderPayloadSchema.extend({
  offerId: z.string().min(1),
  status: z.literal('agreed'),
  agreedAt: z.string().datetime(),
  quoteNetEur: z.number().nonnegative(),
  lane: freightLaneSchema,
})

export type AgreedClientOffer = z.infer<typeof agreedClientOfferSchema>
export type FreightLane = z.infer<typeof freightLaneSchema>
export type { OrderPayload }

type DemoLaneSeed = FreightLane & {
  quoteNetEur: number
  customerName: string
  customerEmail: string
  refPrefix: string
  city: string
  postalCode: string
  line1: string
}

/** Seed pool of PL corridors — demo picks one at random. */
export const DEMO_LANE_SEEDS: DemoLaneSeed[] = [
  {
    from: { name: 'Gdańsk', locality: 'Gdańsk', country: 'PL', lat: 54.352, lng: 18.6466 },
    to: { name: 'Wrocław', locality: 'Wrocław', country: 'PL', lat: 51.1079, lng: 17.0385 },
    weightT: 16,
    ldm: 10,
    pallets: 26,
    searchLocality: 'Bydgoszcz',
    quoteNetEur: 1240,
    customerName: 'Baltic Pack Sp. z o.o.',
    customerEmail: 'logistyka@balticpack.example',
    refPrefix: 'BALTIC-GDN-WRO',
    city: 'Gdańsk',
    postalCode: '80-001',
    line1: 'ul. Długi Targ 12',
  },
  {
    from: { name: 'Kraków', locality: 'Kraków', country: 'PL', lat: 50.0647, lng: 19.945 },
    to: { name: 'Szczecin', locality: 'Szczecin', country: 'PL', lat: 53.4285, lng: 14.5528 },
    weightT: 12,
    ldm: 7,
    pallets: 18,
    searchLocality: 'Łódź',
    quoteNetEur: 1380,
    customerName: 'Małopolska Steel AG',
    customerEmail: 'dispatch@malopolska-steel.example',
    refPrefix: 'STEEL-KRK-SZZ',
    city: 'Kraków',
    postalCode: '30-001',
    line1: 'ul. Dietla 50',
  },
  {
    from: { name: 'Katowice', locality: 'Katowice', country: 'PL', lat: 50.2649, lng: 19.0238 },
    to: { name: 'Lublin', locality: 'Lublin', country: 'PL', lat: 51.2465, lng: 22.5684 },
    weightT: 18,
    ldm: 11,
    pallets: 28,
    searchLocality: 'Kielce',
    quoteNetEur: 890,
    customerName: 'Silesia Components',
    customerEmail: 'ops@silesia-comp.example',
    refPrefix: 'SIL-KTW-LUB',
    city: 'Katowice',
    postalCode: '40-001',
    line1: 'ul. Młyńska 8',
  },
  {
    from: { name: 'Białystok', locality: 'Białystok', country: 'PL', lat: 53.1325, lng: 23.1688 },
    to: { name: 'Opole', locality: 'Opole', country: 'PL', lat: 50.6751, lng: 17.9213 },
    weightT: 14,
    ldm: 8,
    pallets: 22,
    searchLocality: 'Warszawa',
    quoteNetEur: 1120,
    customerName: 'Podlasie Fresh Foods',
    customerEmail: 'transport@podlasie-fresh.example',
    refPrefix: 'PFF-BIA-OPO',
    city: 'Białystok',
    postalCode: '15-001',
    line1: 'ul. Lipowa 3',
  },
  {
    from: { name: 'Rzeszów', locality: 'Rzeszów', country: 'PL', lat: 50.0412, lng: 21.9991 },
    to: { name: 'Poznań', locality: 'Poznań', country: 'PL', lat: 52.4064, lng: 16.9252 },
    weightT: 20,
    ldm: 12,
    pallets: 30,
    searchLocality: 'Łódź',
    quoteNetEur: 1050,
    customerName: 'Podkarpacie Auto Parts',
    customerEmail: 'fleet@pap.example',
    refPrefix: 'PAP-RZE-POZ',
    city: 'Rzeszów',
    postalCode: '35-001',
    line1: 'ul. Grunwaldzka 15',
  },
  {
    from: { name: 'Toruń', locality: 'Toruń', country: 'PL', lat: 53.0138, lng: 18.5984 },
    to: { name: 'Zielona Góra', locality: 'Zielona Góra', country: 'PL', lat: 51.9356, lng: 15.5062 },
    weightT: 11,
    ldm: 6,
    pallets: 16,
    searchLocality: 'Poznań',
    quoteNetEur: 760,
    customerName: 'Vistula Paper Mill',
    customerEmail: 'logistyka@vistula-paper.example',
    refPrefix: 'VPM-TOR-ZGO',
    city: 'Toruń',
    postalCode: '87-100',
    line1: 'ul. Szeroka 7',
  },
]

function pickDemoLaneSeed(): DemoLaneSeed {
  const idx = Math.floor(Math.random() * DEMO_LANE_SEEDS.length)
  return DEMO_LANE_SEEDS[idx]!
}

/** Demo: random agreed client offer from the lane seed pool. */
export function seedAgreedOffer(overrides?: Partial<AgreedClientOffer>): AgreedClientOffer {
  const seed = pickDemoLaneSeed()
  const now = new Date().toISOString()
  const fromCode = seed.from.locality.slice(0, 3).toUpperCase()
  const toCode = seed.to.locality.slice(0, 3).toUpperCase()
  const base: AgreedClientOffer = {
    offerId: `offer-agreed-${fromCode}-${toCode}-${Date.now()}`,
    status: 'agreed',
    agreedAt: now,
    quoteNetEur: seed.quoteNetEur,
    customerName: seed.customerName,
    customerEmail: seed.customerEmail,
    currencyCode: 'EUR',
    customerReference: `${seed.refPrefix}-${String(Date.now()).slice(-4)}`,
    notes: `Agreed FTL ${seed.from.locality} → ${seed.to.locality}. Find a carrier, then optimise load while driving.`,
    lineItems: [
      {
        productName: 'FTL road freight, per shipment',
        sku: 'FTL-SHIPMENT',
        quantity: '1',
        unitPrice: String(seed.quoteNetEur),
        kind: 'service',
        description: `${seed.from.locality} (PL) to ${seed.to.locality} (PL), ~${seed.weightT} t / ${seed.ldm ?? 8} LDM`,
      },
    ],
    shippingAddress: {
      company: seed.customerName,
      contactName: 'Dispatch desk',
      line1: seed.line1,
      city: seed.city,
      postalCode: seed.postalCode,
      country: 'PL',
    },
    billingAddress: {
      company: seed.customerName,
      city: seed.city,
      country: 'PL',
    },
    lane: {
      from: seed.from,
      to: seed.to,
      weightT: seed.weightT,
      ldm: seed.ldm,
      pallets: seed.pallets,
      searchLocality: seed.searchLocality,
    },
  }
  return agreedClientOfferSchema.parse({
    ...base,
    ...overrides,
    lane: { ...base.lane, ...overrides?.lane },
  })
}

/** @deprecated Prefer {@link seedAgreedOffer} (random lane). Kept for old call sites. */
export function seedAgreedWawPozOffer(overrides?: Partial<AgreedClientOffer>): AgreedClientOffer {
  return seedAgreedOffer(overrides)
}
