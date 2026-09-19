/**
 * Backhaul finder: pairs transport jobs so a truck that delivers job A picks up
 * job B nearby instead of driving home empty.
 */
import { estimateRoute, AVERAGE_SPEED_KMH, displayCity, extractCity } from './geo'
import { OWN_FLEET_COST_PER_KM } from './pricing'

export type TransportJob = {
  id: string
  orderNumber: string
  clientName: string
  pickupAddress: string
  deliveryAddress: string
  pickupStart: string | null
  pickupEnd: string | null
  pallets: number | null
  weightKg: number | null
  clientPrice: number | null
  maxCarrierCost: number | null
  dispatchMode: string
  assignedVehicle: string | null
  assignedDriver: string | null
  assignedCarrier: string | null
  carrierCost: number | null
  marginPct: number | null
  dispatchNote: string | null
}

export type BackhaulProposal = {
  id: string
  first: TransportJob
  second: TransportJob
  legs: { label: string; km: number; empty: boolean }[]
  soloKm: number
  combinedKm: number
  savedKm: number
  emptyKmSolo: number
  emptyKmCombined: number
  savedCostPln: number
  combinedRevenue: number
  combinedMarginPct: number | null
  feasible: boolean
  rationale: string
}

/** Max detour we accept between A's delivery and B's pickup. */
export const MAX_CONNECTOR_KM = 200
/** Minimum saving worth showing the dispatcher. */
export const MIN_SAVED_KM = 80

function hoursBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  return (new Date(b).getTime() - new Date(a).getTime()) / 36e5
}

export function findBackhaulProposals(jobs: TransportJob[], homeBase = 'Wrocław'): BackhaulProposal[] {
  const candidates = jobs.filter((job) => job.dispatchMode !== 'subcontractor')
  const proposals: BackhaulProposal[] = []

  for (const first of candidates) {
    for (const second of candidates) {
      if (first.id === second.id) continue

      const legA = estimateRoute(first.pickupAddress, first.deliveryAddress).distanceKm
      const connector = estimateRoute(first.deliveryAddress, second.pickupAddress).distanceKm
      const legB = estimateRoute(second.pickupAddress, second.deliveryAddress).distanceKm
      const homeToA = estimateRoute(homeBase, first.pickupAddress).distanceKm
      const homeToB = estimateRoute(homeBase, second.pickupAddress).distanceKm
      const returnA = estimateRoute(first.deliveryAddress, homeBase).distanceKm
      const returnB = estimateRoute(second.deliveryAddress, homeBase).distanceKm

      if (connector > MAX_CONNECTOR_KM) continue

      const soloKm = homeToA + legA + returnA + homeToB + legB + returnB
      const combinedKm = homeToA + legA + connector + legB + returnB
      const savedKm = soloKm - combinedKm
      if (savedKm < MIN_SAVED_KM) continue

      const emptyKmSolo = homeToA + returnA + homeToB + returnB
      const emptyKmCombined = homeToA + connector + returnB

      // Time feasibility: can we reach B's pickup before its window closes?
      const driveToB = (legA + connector) / AVERAGE_SPEED_KMH + 1.5 // +1.5h unloading
      const windowGap = hoursBetween(first.pickupStart, second.pickupEnd)
      const feasible = windowGap == null ? true : windowGap >= driveToB

      const savedCostPln = Math.round(savedKm * OWN_FLEET_COST_PER_KM)
      const combinedRevenue = (first.clientPrice ?? 0) + (second.clientPrice ?? 0)
      const combinedCost = Math.round(combinedKm * OWN_FLEET_COST_PER_KM)
      const combinedMarginPct = combinedRevenue > 0 ? Math.round(((combinedRevenue - combinedCost) / combinedRevenue) * 1000) / 10 : null

      const rationale = feasible
        ? `Po rozładunku w ${displayCity(extractCity(first.deliveryAddress))} auto jedzie ${connector} km do załadunku ${second.orderNumber} zamiast ${returnA} km pusto do bazy. Oszczędność ${savedKm} km ≈ ${savedCostPln} PLN.`
        : `Trasa geograficznie pasuje (${connector} km łącznika), ale okno załadunku ${second.orderNumber} zamyka się za wcześnie — wymaga przesunięcia terminu z klientem.`

      proposals.push({
        id: `${first.id}__${second.id}`,
        first,
        second,
        legs: [
          { label: `Baza → ${first.orderNumber} załadunek`, km: homeToA, empty: true },
          { label: `${first.orderNumber} przewóz`, km: legA, empty: false },
          { label: `Łącznik → ${second.orderNumber} załadunek`, km: connector, empty: true },
          { label: `${second.orderNumber} przewóz`, km: legB, empty: false },
          { label: `Powrót do bazy`, km: returnB, empty: true },
        ],
        soloKm,
        combinedKm,
        savedKm,
        emptyKmSolo,
        emptyKmCombined,
        savedCostPln,
        combinedRevenue,
        combinedMarginPct,
        feasible,
        rationale,
      })
    }
  }

  proposals.sort((a, b) => Number(b.feasible) - Number(a.feasible) || b.savedKm - a.savedKm)
  // One proposal per leading job keeps the list readable.
  const seen = new Set<string>()
  return proposals.filter((proposal) => {
    if (seen.has(proposal.first.id) || seen.has(proposal.second.id)) return false
    seen.add(proposal.first.id)
    seen.add(proposal.second.id)
    return true
  })
}
