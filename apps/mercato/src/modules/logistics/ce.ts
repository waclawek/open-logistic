import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'
import { cf } from '@open-mercato/shared/modules/dsl'
import { VEHICLE_TYPE_NAMES } from './lib/vehicle-types'
import labels from './i18n/en.json'

const transportGroup = { code: 'transport', title: 'logistics.groups.transport' }
const carrierGroup = { code: 'carrier', title: 'logistics.groups.carrier' }

export const LOGISTICS_ENTITY_IDS = [
  'sales:sales_order',
  'customers:customer_company_profile',
] as const

export const TRANSPORT_ROLES = ['client', 'carrier', 'additional_load'] as const
export const EXCHANGE_SOURCES = ['seed', 'manual', 'trans', 'timocom'] as const

export const entities: CustomEntitySpec[] = [
  {
    id: 'sales:sales_order',
    fields: [
      cf.text('source_offer_id', { label: labels['logistics.fields.sourceOffer'], group: transportGroup }),
      cf.text('legacy_transport_id', { label: labels['logistics.fields.legacyTransport'], group: transportGroup, indexed: true }),
      cf.integer('transport_order_number', { label: labels['logistics.fields.orderNumber'], group: transportGroup }),
      cf.datetime('delivery_window_start', { label: labels['logistics.fields.deliveryWindow'], group: transportGroup }),

      cf.select('transport_role', [...TRANSPORT_ROLES], {
        label: labels['logistics.fields.transportRole'],
        group: transportGroup,
        formEditable: true,
        listVisible: true,
        filterable: true,
        indexed: true,
      }),
      cf.text('transport_parent_id', {
        label: labels['logistics.fields.parentTransport'],
        group: transportGroup,
        formEditable: true,
        filterable: true,
        indexed: true,
      }),
      cf.text('pickup_address', {
        label: labels['logistics.fields.pickupAddress'],
        group: transportGroup,
        formEditable: true,
        listVisible: true,
        filterable: true,
        indexed: true,
      }),
      cf.text('delivery_address', {
        label: labels['logistics.fields.deliveryAddress'],
        group: transportGroup,
        formEditable: true,
        listVisible: true,
        filterable: true,
        indexed: true,
      }),
      cf.datetime('pickup_window_start', {
        label: labels['logistics.fields.pickupWindowStart'],
        group: transportGroup,
        formEditable: true,
        listVisible: true,
        filterable: true,
      }),
      cf.datetime('pickup_window_end', {
        label: labels['logistics.fields.pickupWindowEnd'],
        group: transportGroup,
        formEditable: true,
        filterable: true,
      }),
      cf.float('cargo_pallets', {
        label: labels['logistics.fields.cargoPallets'],
        group: transportGroup,
        formEditable: true,
        listVisible: true,
        filterable: true,
      }),
      cf.float('cargo_weight_kg', {
        label: labels['logistics.fields.cargoWeight'],
        group: transportGroup,
        formEditable: true,
      }),
      cf.float('client_price', {
        label: labels['logistics.fields.clientPrice'],
        group: transportGroup,
        formEditable: true,
        listVisible: true,
      }),
      cf.float('max_carrier_cost', {
        label: labels['logistics.fields.maxCarrierCost'],
        group: transportGroup,
        formEditable: true,
      }),
      cf.select('vehicle_type', [...VEHICLE_TYPE_NAMES], {
        label: labels['logistics.fields.vehicleType'],
        group: carrierGroup,
        formEditable: true,
      }),
      cf.float('vehicle_capacity_pallets', {
        label: labels['logistics.fields.vehicleCapacityPallets'],
        group: carrierGroup,
        formEditable: true,
      }),
      cf.float('vehicle_capacity_kg', {
        label: labels['logistics.fields.vehicleCapacityWeight'],
        group: carrierGroup,
        formEditable: true,
      }),
      cf.text('vehicle_plate', {
        label: labels['logistics.fields.vehiclePlate'],
        group: carrierGroup,
        formEditable: true,
      }),
      cf.float('carrier_cost', {
        label: labels['logistics.fields.carrierCost'],
        group: carrierGroup,
        formEditable: true,
      }),
      cf.select('exchange_source', [...EXCHANGE_SOURCES], {
        label: labels['logistics.fields.exchangeSource'],
        group: transportGroup,
        formEditable: true,
        filterable: true,
      }),
      cf.text('exchange_ref', {
        label: labels['logistics.fields.exchangeReference'],
        group: transportGroup,
        formEditable: true,
        filterable: true,
        indexed: true,
      }),
      cf.multiline('dispatch_note', {
        label: labels['logistics.fields.dispatchNote'],
        group: transportGroup,
        formEditable: true,
        editor: 'plain',
      }),
    ],
  },
  {
    id: 'customers:customer_company_profile',
    fields: [
      cf.boolean('is_carrier', {
        label: labels['logistics.fields.carrier'],
        defaultValue: false,
        formEditable: true,
        listVisible: true,
        filterable: true,
        indexed: true,
      }),
      cf.integer('carrier_rating', {
        label: labels['logistics.fields.carrierRating'],
        formEditable: true,
        listVisible: true,
        filterable: true,
        validation: [
          { rule: 'integer', message: 'logistics.errors.carrierRatingInteger' },
          { rule: 'gte', param: 1, message: 'logistics.errors.carrierRatingMinimum' },
          { rule: 'lte', param: 5, message: 'logistics.errors.carrierRatingMaximum' },
        ],
      }),
    ],
  },
]

export default entities
