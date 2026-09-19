import type { TransportFields, TransportRole } from '../types'

export const LOGISTICS_METADATA_VERSION = 1
export const LOGISTICS_CLIENT_TRANSPORT_KIND = 'client_transport'

const TRANSPORT_ROLES = new Set<TransportRole>(['client', 'carrier', 'additional_load'])

const FIELD_KEYS = [
  ['transportRole', 'transport_role'],
  ['transportParentId', 'transport_parent_id'],
  ['transportOrderNumber', 'transport_order_number'],
  ['pickupAddress', 'pickup_address'],
  ['deliveryAddress', 'delivery_address'],
  ['pickupWindowStart', 'pickup_window_start'],
  ['pickupWindowEnd', 'pickup_window_end'],
  ['deliveryWindowStart', 'delivery_window_start'],
  ['cargoPallets', 'cargo_pallets'],
  ['cargoWeightKg', 'cargo_weight_kg'],
  ['clientPrice', 'client_price'],
  ['maxCarrierCost', 'max_carrier_cost'],
  ['vehicleType', 'vehicle_type'],
  ['vehicleCapacityPallets', 'vehicle_capacity_pallets'],
  ['vehicleCapacityKg', 'vehicle_capacity_kg'],
  ['vehiclePlate', 'vehicle_plate'],
  ['carrierCost', 'carrier_cost'],
  ['exchangeSource', 'exchange_source'],
  ['exchangeReference', 'exchange_ref', 'exchangeRef'],
  ['dispatchNote', 'dispatch_note'],
  ['sourceOfferId', 'source_offer_id'],
  ['legacyTransportId', 'legacy_transport_id'],
] as const

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function transportValue(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))
}

function metadataValue(
  logistics: Record<string, unknown>,
  camelKey: string,
  fieldKey: string,
  legacyCamelKey?: string,
): unknown {
  if (Object.prototype.hasOwnProperty.call(logistics, camelKey)) return logistics[camelKey]
  if (legacyCamelKey && Object.prototype.hasOwnProperty.call(logistics, legacyCamelKey)) return logistics[legacyCamelKey]
  return logistics[fieldKey]
}

export function transportFieldsFromMetadata(metadata: Record<string, unknown> | null | undefined): TransportFields {
  const logistics = record(metadata?.logistics)
  if (
    !logistics
    || logistics.version !== LOGISTICS_METADATA_VERSION
    || logistics.kind !== LOGISTICS_CLIENT_TRANSPORT_KIND
  ) return {}

  const fields: TransportFields = {}
  for (const [camelKey, fieldKey, legacyCamelKey] of FIELD_KEYS) {
    const value = metadataValue(logistics, camelKey, fieldKey, legacyCamelKey)
    if (transportValue(value)) fields[fieldKey] = value
  }

  if (!TRANSPORT_ROLES.has(fields.transport_role as TransportRole)) delete fields.transport_role
  return fields
}

export function transportRoleFromMetadata(metadata: Record<string, unknown> | null | undefined): TransportRole | null {
  const role = transportFieldsFromMetadata(metadata).transport_role
  return TRANSPORT_ROLES.has(role as TransportRole) ? role as TransportRole : null
}
