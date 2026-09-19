export type VehicleRate = {
  eurPerKm: number
  minimumEur: number
}

export type VehicleTypeDefinition = {
  name: string
  payloadKg: number | null
  lengthM: number | null
  palletSpaces: number | null
  curtainsider: VehicleRate
  refrigerated: VehicleRate
  tailLiftSurchargeEur: number
}

export const VEHICLE_TYPES = [
  {
    name: 'FTL',
    payloadKg: 24_000,
    lengthM: 13.6,
    palletSpaces: 33,
    curtainsider: { eurPerKm: 1.2, minimumEur: 500 },
    refrigerated: { eurPerKm: 1.4, minimumEur: 600 },
    tailLiftSurchargeEur: 400,
  },
  {
    name: 'Solo 18t DMC',
    payloadKg: 9_000,
    lengthM: 9,
    palletSpaces: 22,
    curtainsider: { eurPerKm: 1.1, minimumEur: 400 },
    refrigerated: { eurPerKm: 1.3, minimumEur: 500 },
    tailLiftSurchargeEur: 400,
  },
  {
    name: 'Solo 12t DMC',
    payloadKg: 6_000,
    lengthM: 7.2,
    palletSpaces: 18,
    curtainsider: { eurPerKm: 1, minimumEur: 400 },
    refrigerated: { eurPerKm: 1.2, minimumEur: 500 },
    tailLiftSurchargeEur: 400,
  },
  {
    name: 'Solo 7,5t DMC',
    payloadKg: 3_500,
    lengthM: 6,
    palletSpaces: 14,
    curtainsider: { eurPerKm: 0.9, minimumEur: 400 },
    refrigerated: { eurPerKm: 1, minimumEur: 500 },
    tailLiftSurchargeEur: 350,
  },
  {
    name: 'Bus 4,2×2,0×2,0',
    payloadKg: 1_000,
    lengthM: 4.2,
    palletSpaces: 8,
    curtainsider: { eurPerKm: 0.8, minimumEur: 300 },
    refrigerated: { eurPerKm: 0.9, minimumEur: 400 },
    tailLiftSurchargeEur: 250,
  },
  {
    name: 'Bus blaszak',
    payloadKg: 1_000,
    lengthM: 3.2,
    palletSpaces: 4,
    curtainsider: { eurPerKm: 0.6, minimumEur: 300 },
    refrigerated: { eurPerKm: 0.9, minimumEur: 400 },
    tailLiftSurchargeEur: 250,
  },
] as const satisfies readonly VehicleTypeDefinition[]

export type VehicleTypeName = (typeof VEHICLE_TYPES)[number]['name']

export const VEHICLE_TYPE_NAMES = VEHICLE_TYPES.map((vehicle) => vehicle.name) as VehicleTypeName[]

export function getVehicleTypeDefinition(name: string): VehicleTypeDefinition | null {
  return VEHICLE_TYPES.find((vehicle) => vehicle.name === name) ?? null
}
