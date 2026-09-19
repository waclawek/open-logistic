/**
 * Deterministic pricing rules for a transport job.
 *
 * The agent proposes, this module decides: the LLM never invents a price, it
 * calls `priceJob` and reports the result.
 */
import { estimateRoute } from './geo'

/** Fully loaded cost of running our own truck: fuel, driver, tolls, wear. */
export const OWN_FLEET_COST_PER_KM = 3.1
/** Margin we aim for when quoting a client from scratch. */
export const TARGET_MARGIN_PCT = 18
/** Below this margin we would rather buy the transport from a subcontractor. */
export const MIN_OWN_FLEET_MARGIN_PCT = 10
/** Carriers rated at or below this always need a human decision. */
export const RISKY_CARRIER_RATING = 2

export type CarrierProfile = {
  id: string
  name: string
  ratePerKm: number
  rating: number
  negotiable: boolean
  vehicleTypes: string
}

export type VehicleProfile = {
  id: string
  name: string
  plate: string
  capacityPallets: number
  maxWeightKg: number
  homeBase: string
  status: string
}

export type CarrierOffer = CarrierProfile & {
  cost: number
  marginPct: number | null
  withinCeiling: boolean
  risky: boolean
}

export type Recommendation = 'own_fleet' | 'subcontractor' | 'negotiate' | 'human_review'

export type PriceJobInput = {
  from: string
  to: string
  pallets?: number | null
  weightKg?: number | null
  clientPrice?: number | null
  maxCarrierCost?: number | null
  carriers: CarrierProfile[]
  vehicles: VehicleProfile[]
}

export type PriceJobResult = {
  route: ReturnType<typeof estimateRoute>
  ownFleet: {
    cost: number
    marginPct: number | null
    availableVehicle: VehicleProfile | null
  }
  carrierOffers: CarrierOffer[]
  bestCarrier: CarrierOffer | null
  suggestedClientPrice: number
  recommendation: Recommendation
  rationale: string
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step
}

function marginPct(clientPrice: number | null | undefined, cost: number): number | null {
  if (!clientPrice || clientPrice <= 0) return null
  return Math.round(((clientPrice - cost) / clientPrice) * 1000) / 10
}

export function pickAvailableVehicle(vehicles: VehicleProfile[], pallets?: number | null, weightKg?: number | null): VehicleProfile | null {
  const fits = vehicles.filter((v) => {
    if (v.status !== 'available') return false
    if (pallets && v.capacityPallets && v.capacityPallets < pallets) return false
    if (weightKg && v.maxWeightKg && v.maxWeightKg < weightKg) return false
    return true
  })
  // Smallest vehicle that fits keeps the big trucks free for big loads.
  fits.sort((a, b) => (a.capacityPallets ?? 0) - (b.capacityPallets ?? 0))
  return fits[0] ?? null
}

export function priceJob(input: PriceJobInput): PriceJobResult {
  const route = estimateRoute(input.from, input.to)
  const km = route.distanceKm
  const ownCost = Math.round(km * OWN_FLEET_COST_PER_KM)
  const availableVehicle = pickAvailableVehicle(input.vehicles, input.pallets, input.weightKg)
  const ownMargin = marginPct(input.clientPrice, ownCost)

  const ceiling = input.maxCarrierCost ?? (input.clientPrice ? input.clientPrice * (1 - MIN_OWN_FLEET_MARGIN_PCT / 100) : null)
  const carrierOffers: CarrierOffer[] = input.carriers
    .map((carrier) => {
      const cost = Math.round(km * carrier.ratePerKm)
      return {
        ...carrier,
        cost,
        marginPct: marginPct(input.clientPrice, cost),
        withinCeiling: ceiling == null ? true : cost <= ceiling,
        risky: carrier.rating <= RISKY_CARRIER_RATING,
      }
    })
    .sort((a, b) => a.cost - b.cost)

  const safeOffers = carrierOffers.filter((offer) => offer.withinCeiling && !offer.risky)
  const bestCarrier = safeOffers[0] ?? carrierOffers.find((offer) => offer.withinCeiling) ?? null

  const suggestedClientPrice = roundTo(ownCost * (1 + TARGET_MARGIN_PCT / 100), 50)

  let recommendation: Recommendation
  let rationale: string
  const kmLabel = route.known ? `${km} km` : `~${km} km (miasto nieznane, przyjęto 500 km)`

  if (availableVehicle && (ownMargin == null || ownMargin >= MIN_OWN_FLEET_MARGIN_PCT)) {
    recommendation = 'own_fleet'
    rationale = `Własne auto ${availableVehicle.plate} jest wolne. Trasa ${kmLabel}, koszt własny ${ownCost} PLN` +
      (ownMargin != null ? `, marża ${ownMargin}%` : `, sugerowana cena ${suggestedClientPrice} PLN`) + '.'
  } else if (bestCarrier && !bestCarrier.risky) {
    recommendation = 'subcontractor'
    rationale = `Brak wolnego auta lub za niska marża własna (${ownMargin ?? '–'}%). Najtańszy bezpieczny przewoźnik ${bestCarrier.name}: ${bestCarrier.cost} PLN` +
      (bestCarrier.marginPct != null ? `, marża ${bestCarrier.marginPct}%` : '') + `, ocena ${bestCarrier.rating}/5.`
  } else if (carrierOffers.some((offer) => offer.negotiable && !offer.risky)) {
    recommendation = 'negotiate'
    const candidate = carrierOffers.find((offer) => offer.negotiable && !offer.risky)!
    rationale = `Żadna oferta nie mieści się w limicie ${ceiling ? Math.round(ceiling) : '–'} PLN. ${candidate.name} negocjuje, obecnie ${candidate.cost} PLN.`
  } else {
    recommendation = 'human_review'
    rationale = bestCarrier
      ? `Jedyna oferta w limicie to ${bestCarrier.name} z oceną ${bestCarrier.rating}/5 — wymaga decyzji dyspozytora.`
      : `Brak wolnego auta i żaden przewoźnik nie mieści się w limicie. Wymaga decyzji dyspozytora.`
  }

  return {
    route,
    ownFleet: { cost: ownCost, marginPct: ownMargin, availableVehicle },
    carrierOffers,
    bestCarrier,
    suggestedClientPrice,
    recommendation,
    rationale,
  }
}
