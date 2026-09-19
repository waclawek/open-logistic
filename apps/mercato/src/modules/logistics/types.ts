export type TransportRole = 'client' | 'carrier' | 'additional_load'
export type CarrierStatus = 'none' | 'pending_approval' | 'approved'
export type CapacityUnit = 'pallets' | 'kg'

export type TransportFields = Record<string, string | number | boolean | null>

export type TransportOrder = {
  id: string
  orderNumber: string
  currencyCode: string
  status: string
  customerId: string | null
  customerName: string
  updatedAt: string
  fields: TransportFields
}

export type FreeSpace = {
  pallets: number | null
  kg: number | null
  limiting: CapacityUnit | null
}

export type TransportRow = {
  currencyCode: string
  id: string
  orderNumber: string
  customerName: string
  pickupAddress: string | null
  deliveryAddress: string | null
  pickupWindowStart: string | null
  pickupWindowEnd: string | null
  cargoPallets: number | null
  cargoWeightKg: number | null
  clientPrice: number | null
  carrier: {
    orderId: string
    name: string
    status: 'pending_approval' | 'approved'
    cost: number | null
    vehicleType: string | null
    updatedAt: string
  } | null
  additionalLoads: {
    pending: number
    approved: number
    pendingOrderId: string | null
    pendingUpdatedAt: string | null
  }
  freeSpace: FreeSpace | null
  updatedAt: string
}

export type TransportDetail = {
  transportVersion: string
  updatedAt: string
  order1: TransportOrder
  order2: TransportOrder | null
  carrierHistory: TransportOrder[]
  additionalLoads: TransportOrder[]
  freeSpace: FreeSpace | null
}

export type TransportListResponse = {
  totalPages: number
  items: TransportRow[]
  total: number
  page: number
  pageSize: number
}
