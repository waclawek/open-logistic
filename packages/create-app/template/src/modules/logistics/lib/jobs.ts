/**
 * Server-side loaders that turn core records (sales orders, company profiles,
 * resources) into the logistics view models.
 *
 * Custom fields are read straight from `custom_field_values` through the ORM
 * instead of the query index, so freshly seeded or edited values show up
 * immediately without waiting for index workers.
 */
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import { CustomerCompanyProfile, CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { ResourcesResource } from '@open-mercato/core/modules/resources/data/entities'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import { E } from '@/.mercato/generated/entities.ids.generated'
import type { TransportJob } from './backhaul'
import type { CarrierProfile, VehicleProfile } from './pricing'

export type LogisticsScope = { tenantId: string; organizationId: string }

type FieldMap = Map<string, Record<string, unknown>>

function str(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  return s.length ? s : null
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function bool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return ['true', '1', 't', 'yes'].includes(value.toLowerCase())
  return value === 1
}

function iso(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  const d = new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** All custom-field values for one entity type, keyed by record id. */
async function loadFieldMap(em: EntityManager, scope: LogisticsScope, entityId: string): Promise<FieldMap> {
  const rows = await em.find(CustomFieldValue, {
    entityId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  const map: FieldMap = new Map()
  for (const row of rows) {
    const value =
      row.valueText ?? row.valueMultiline ?? row.valueInt ?? row.valueFloat ?? (row.valueBool == null ? null : row.valueBool)
    if (value == null) continue
    const bucket = map.get(row.recordId) ?? {}
    bucket[row.fieldKey] = value
    map.set(row.recordId, bucket)
  }
  return map
}

async function customerNames(em: EntityManager, scope: LogisticsScope, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return new Map()
  const rows = await findWithDecryption(
    em,
    CustomerEntity,
    { id: { $in: unique }, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
  return new Map(rows.map((row) => [row.id, row.displayName]))
}

export async function loadTransportJobs(container: AwilixContainer, scope: LogisticsScope): Promise<TransportJob[]> {
  const em = container.resolve('em') as EntityManager
  const [orders, fields] = await Promise.all([
    findWithDecryption(
      em,
      SalesOrder,
      { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      { orderBy: { createdAt: 'desc' }, limit: 300 },
      scope,
    ),
    loadFieldMap(em, scope, E.sales.sales_order),
  ])
  const rows = orders
    .map((order) => ({ order, cf: fields.get(order.id) ?? {} }))
    .filter(({ cf }) => str(cf.pickup_address) && str(cf.delivery_address))
  const names = await customerNames(em, scope, rows.map(({ order }) => order.customerEntityId ?? ''))
  return rows.map(({ order, cf }) => ({
    id: order.id,
    orderNumber: order.orderNumber ?? order.id.slice(0, 8),
    clientName: names.get(order.customerEntityId ?? '') ?? 'Klient',
    pickupAddress: str(cf.pickup_address) ?? '',
    deliveryAddress: str(cf.delivery_address) ?? '',
    pickupStart: iso(cf.pickup_window_start),
    pickupEnd: iso(cf.pickup_window_end),
    pallets: num(cf.cargo_pallets),
    weightKg: num(cf.cargo_weight_kg),
    clientPrice: num(cf.client_price) ?? num(order.grandTotalNetAmount),
    maxCarrierCost: num(cf.max_carrier_cost),
    dispatchMode: str(cf.dispatch_mode) ?? 'unassigned',
    assignedVehicle: str(cf.assigned_vehicle),
    assignedDriver: str(cf.assigned_driver),
    assignedCarrier: str(cf.assigned_carrier),
    carrierCost: num(cf.carrier_cost),
    marginPct: num(cf.margin_pct),
    dispatchNote: str(cf.dispatch_note),
  }))
}

export async function loadCarriers(container: AwilixContainer, scope: LogisticsScope): Promise<CarrierProfile[]> {
  const em = container.resolve('em') as EntityManager
  const [profiles, fields] = await Promise.all([
    em.find(CustomerCompanyProfile, { tenantId: scope.tenantId, organizationId: scope.organizationId }, { populate: [] }),
    loadFieldMap(em, scope, E.customers.customer_company_profile),
  ])
  const carriers = profiles
    .map((profile) => ({ profile, cf: fields.get(profile.id) ?? {} }))
    .filter(({ cf }) => bool(cf.is_carrier))
  const entityIds = carriers.map(({ profile }) => (profile.entity as unknown as { id: string })?.id ?? String(profile.entity))
  const names = await customerNames(em, scope, entityIds)
  return carriers
    .map(({ profile, cf }, index) => ({
      id: entityIds[index] ?? profile.id,
      name: names.get(entityIds[index] ?? '') ?? 'Przewoźnik',
      ratePerKm: num(cf.carrier_rate_per_km) ?? 4,
      rating: num(cf.carrier_rating) ?? 3,
      negotiable: bool(cf.carrier_negotiable),
      vehicleTypes: str(cf.carrier_vehicle_types) ?? '',
    }))
    .filter((carrier) => names.has(carrier.id))
    .sort((a, b) => a.ratePerKm - b.ratePerKm)
}

export async function loadVehicles(container: AwilixContainer, scope: LogisticsScope): Promise<VehicleProfile[]> {
  const em = container.resolve('em') as EntityManager
  const [resources, fields] = await Promise.all([
    em.find(ResourcesResource, { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }),
    loadFieldMap(em, scope, E.resources.resources_resource),
  ])
  return resources
    .map((resource) => ({ resource, cf: fields.get(resource.id) ?? {} }))
    .filter(({ cf }) => str(cf.plate_number))
    .map(({ resource, cf }) => ({
      id: resource.id,
      name: resource.name,
      plate: str(cf.plate_number) ?? '',
      capacityPallets: num(resource.capacity) ?? 0,
      maxWeightKg: num(cf.max_weight_kg) ?? 0,
      homeBase: str(cf.home_base_city) ?? 'Wrocław',
      status: str(cf.vehicle_status) ?? (resource.isActive ? 'available' : 'maintenance'),
    }))
}

export type DriverProfile = {
  id: string
  name: string
  phone: string | null
  licenses: string | null
  status: string
}

export async function loadDrivers(container: AwilixContainer, scope: LogisticsScope): Promise<DriverProfile[]> {
  const em = container.resolve('em') as EntityManager
  const { StaffTeamMember } = await import('@open-mercato/core/modules/staff/data/entities')
  const [members, fields] = await Promise.all([
    findWithDecryption(em, StaffTeamMember, { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }, undefined, scope),
    loadFieldMap(em, scope, E.staff.staff_team_member),
  ])
  return members
    .map((member) => ({ member, cf: fields.get(member.id) ?? {} }))
    .filter(({ cf }) => str(cf.driver_status) || str(cf.license_categories))
    .map(({ member, cf }) => ({
      id: member.id,
      name: member.displayName,
      phone: str(cf.driver_phone),
      licenses: str(cf.license_categories),
      status: str(cf.driver_status) ?? (member.isActive ? 'available' : 'off_duty'),
    }))
}
