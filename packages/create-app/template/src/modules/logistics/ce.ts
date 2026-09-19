import type { CustomEntitySpec } from '@open-mercato/shared/modules/entities'
import { cf } from '@open-mercato/shared/modules/dsl'
import { E } from '@/.mercato/generated/entities.ids.generated'

const transportGroup = { code: 'transport', title: 'Transport' }
const dispatchGroup = { code: 'dispatch', title: 'Dispatch' }

export const LOGISTICS_ENTITY_IDS = [
  E.sales.sales_order,
  E.customers.customer_company_profile,
  E.resources.resources_resource,
  E.staff.staff_team_member,
] as const

export const DISPATCH_MODES = ['unassigned', 'own_fleet', 'subcontractor'] as const
export const VEHICLE_STATUSES = ['available', 'in_transit', 'maintenance'] as const
export const DRIVER_STATUSES = ['available', 'on_route', 'off_duty'] as const

export const entities: CustomEntitySpec[] = [
  {
    id: E.sales.sales_order,
    fields: [
      cf.text('pickup_address', { label: 'Pickup address', group: transportGroup, formEditable: true, listVisible: true, filterable: true, indexed: true }),
      cf.text('delivery_address', { label: 'Delivery address', group: transportGroup, formEditable: true, listVisible: true, filterable: true, indexed: true }),
      cf.datetime('pickup_window_start', { label: 'Pickup window start', group: transportGroup, formEditable: true, listVisible: true, filterable: true }),
      cf.datetime('pickup_window_end', { label: 'Pickup window end', group: transportGroup, formEditable: true, filterable: true }),
      cf.integer('cargo_pallets', { label: 'Cargo (pallets)', group: transportGroup, formEditable: true, listVisible: true, filterable: true }),
      cf.integer('cargo_weight_kg', { label: 'Cargo weight (kg)', group: transportGroup, formEditable: true }),
      cf.float('client_price', { label: 'Client price (PLN)', group: transportGroup, formEditable: true, listVisible: true }),
      cf.float('max_carrier_cost', { label: 'Max subcontractor cost (PLN)', description: 'Business rule ceiling for buying the transport from a carrier.', group: transportGroup, formEditable: true }),
      cf.select('dispatch_mode', [...DISPATCH_MODES], { label: 'Dispatch mode', group: dispatchGroup, defaultValue: 'unassigned', formEditable: true, listVisible: true, filterable: true, indexed: true }),
      cf.text('assigned_vehicle', { label: 'Assigned vehicle', group: dispatchGroup, formEditable: true, listVisible: true }),
      cf.text('assigned_driver', { label: 'Assigned driver', group: dispatchGroup, formEditable: true }),
      cf.text('assigned_carrier', { label: 'Assigned carrier', group: dispatchGroup, formEditable: true, listVisible: true, filterable: true }),
      cf.float('carrier_cost', { label: 'Carrier cost (PLN)', group: dispatchGroup, formEditable: true }),
      cf.float('margin_pct', { label: 'Margin (%)', group: dispatchGroup, formEditable: true, listVisible: true }),
      cf.multiline('dispatch_note', { label: 'Dispatch note', description: 'Rationale recorded by the dispatcher or the AI agent.', group: dispatchGroup, formEditable: true }),
    ],
  },
  {
    id: E.customers.customer_company_profile,
    fields: [
      cf.boolean('is_carrier', { label: 'Subcontractor (carrier)', defaultValue: false, formEditable: true, listVisible: true, filterable: true, indexed: true }),
      cf.integer('carrier_rating', { label: 'Carrier rating (1-5)', formEditable: true, listVisible: true, filterable: true }),
      cf.float('carrier_rate_per_km', { label: 'Carrier rate (PLN/km)', formEditable: true }),
      cf.boolean('carrier_negotiable', { label: 'Open to negotiation', defaultValue: false, formEditable: true }),
      cf.text('carrier_vehicle_types', { label: 'Carrier vehicle types', formEditable: true }),
    ],
  },
  {
    id: E.resources.resources_resource,
    fields: [
      cf.text('plate_number', { label: 'Plate number', formEditable: true, listVisible: true, filterable: true, indexed: true }),
      cf.integer('max_weight_kg', { label: 'Max load (kg)', formEditable: true }),
      cf.text('home_base_city', { label: 'Home base', formEditable: true, listVisible: true, filterable: true }),
      cf.select('vehicle_status', [...VEHICLE_STATUSES], { label: 'Vehicle status', defaultValue: 'available', formEditable: true, listVisible: true, filterable: true, indexed: true }),
    ],
  },
  {
    id: E.staff.staff_team_member,
    fields: [
      cf.phone('driver_phone', { label: 'Driver phone', formEditable: true }),
      cf.text('license_categories', { label: 'Licence categories', formEditable: true, listVisible: true }),
      cf.select('driver_status', [...DRIVER_STATUSES], { label: 'Driver status', defaultValue: 'available', formEditable: true, listVisible: true, filterable: true, indexed: true }),
    ],
  },
]

export default entities
