import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureRoles } from '@open-mercato/core/modules/auth/lib/setup-app'
import { ResourcesResource, ResourcesResourceType } from '@open-mercato/core/modules/resources/data/entities'
import { PlannerAvailabilityRuleSet } from '@open-mercato/core/modules/planner/data/entities'
import { StaffTeam, StaffTeamMember } from '@open-mercato/core/modules/staff/data/entities'
import { CustomerEntity, CustomerTag } from '@open-mercato/core/modules/customers/data/entities'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { E } from '@/.mercato/generated/entities.ids.generated'

export const LOGISTICS_DISPATCHER_ROLE = 'dyspozytor'

export type LogisticsSeedScope = { tenantId: string; organizationId: string }
export type LogisticsSeedOptions = { logger?: (message: string) => void }

type Scope = LogisticsSeedScope
type Log = (message: string) => void

const TIMEZONE = 'Europe/Warsaw'
const CURRENCY = 'PLN'
const WORKING_WEEKDAYS = [1, 2, 3, 4, 5]

const RESOURCE_TYPES = [
  { name: 'Ciągnik z naczepą', description: 'Zestaw 33 palety, transport międzynarodowy.', appearanceIcon: 'truck', appearanceColor: '#2563eb' },
  { name: 'Solówka', description: 'Ciężarówka 18 palet, dystrybucja krajowa.', appearanceIcon: 'truck', appearanceColor: '#16a34a' },
] as const

const VEHICLES = [
  { name: 'WR 10001', typeName: 'Ciągnik z naczepą', capacity: 33, plate: 'WR 10001', maxWeightKg: 24000, homeBase: 'Wrocław', status: 'available' },
  { name: 'WR 10002', typeName: 'Ciągnik z naczepą', capacity: 33, plate: 'WR 10002', maxWeightKg: 24000, homeBase: 'Wrocław', status: 'in_transit' },
  { name: 'WR 20001', typeName: 'Solówka', capacity: 18, plate: 'WR 20001', maxWeightKg: 9000, homeBase: 'Wrocław', status: 'available' },
  { name: 'WR 20002', typeName: 'Solówka', capacity: 18, plate: 'WR 20002', maxWeightKg: 9000, homeBase: 'Poznań', status: 'maintenance' },
] as const

const DRIVERS = [
  { displayName: 'Marek Nowak', phone: '+48 600 100 001', licenses: 'C, C+E', status: 'available' },
  { displayName: 'Piotr Zieliński', phone: '+48 600 100 002', licenses: 'C, C+E', status: 'on_route' },
  { displayName: 'Anna Wójcik', phone: '+48 600 100 003', licenses: 'C', status: 'available' },
  { displayName: 'Tomasz Kowal', phone: '+48 600 100 004', licenses: 'C, C+E, ADR', status: 'off_duty' },
] as const

const CLIENTS = [
  { displayName: 'Meble Wrocław Sp. z o.o.', primaryEmail: 'logistyka@meble-wroclaw.example', industry: 'Furniture' },
  { displayName: 'AgroPak S.A.', primaryEmail: 'spedycja@agropak.example', industry: 'Food' },
] as const

const CARRIERS = [
  { displayName: 'TransNord', primaryEmail: 'dispo@transnord.example', rating: 5, ratePerKm: 4.2, negotiable: false, vehicleTypes: 'Ciągnik z naczepą, chłodnia' },
  { displayName: 'SpedPol', primaryEmail: 'oferty@spedpol.example', rating: 4, ratePerKm: 3.9, negotiable: true, vehicleTypes: 'Ciągnik z naczepą' },
  { displayName: 'EuroTrans Berlin', primaryEmail: 'office@eurotrans.example', rating: 3, ratePerKm: 3.6, negotiable: false, vehicleTypes: 'Ciągnik z naczepą, solówka' },
  { displayName: 'Szybki Kurs', primaryEmail: 'biuro@szybkikurs.example', rating: 2, ratePerKm: 3.2, negotiable: true, vehicleTypes: 'Solówka, bus' },
] as const

const TRANSPORT_JOBS = [
  { clientName: 'Meble Wrocław Sp. z o.o.', pickup: 'ul. Fabryczna 12, 54-010 Wrocław', delivery: 'Warschauer Str. 70, 10243 Berlin', pallets: 24, weightKg: 11000, clientPrice: 2800, maxCarrierCost: 2400, pickupInDays: 1, pickupHour: 8 },
  { clientName: 'AgroPak S.A.', pickup: 'ul. Portowa 3, 51-115 Wrocław', delivery: 'Am Sandtorkai 40, 20457 Hamburg', pallets: 33, weightKg: 21000, clientPrice: 4200, maxCarrierCost: 3600, pickupInDays: 1, pickupHour: 6 },
  { clientName: 'Meble Wrocław Sp. z o.o.', pickup: 'ul. Głogowska 200, 60-104 Poznań', delivery: 'Na Poříčí 26, 110 00 Praha', pallets: 12, weightKg: 5500, clientPrice: 1900, maxCarrierCost: 1700, pickupInDays: 2, pickupHour: 10 },
  { clientName: 'AgroPak S.A.', pickup: 'ul. Portowa 3, 51-115 Wrocław', delivery: 'ul. Kontenerowa 7, 80-601 Gdańsk', pallets: 20, weightKg: 9800, clientPrice: 2300, maxCarrierCost: 2000, pickupInDays: 2, pickupHour: 7 },
  // Return loads — these make the backhaul planner light up (Berlin → Wrocław after Wrocław → Berlin, Praha → Wrocław after Poznań → Praha).
  { clientName: 'Meble Wrocław Sp. z o.o.', pickup: 'Alt-Moabit 90, 10559 Berlin', delivery: 'ul. Fabryczna 12, 54-010 Wrocław', pallets: 20, weightKg: 9000, clientPrice: 2400, maxCarrierCost: 2000, pickupInDays: 1, pickupHour: 16 },
  { clientName: 'AgroPak S.A.', pickup: 'Průmyslová 11, 102 00 Praha', delivery: 'ul. Portowa 3, 51-115 Wrocław', pallets: 10, weightKg: 4000, clientPrice: 1500, maxCarrierCost: 1300, pickupInDays: 2, pickupHour: 17 },
] as const

function buildCommandContext(container: AwilixContainer, scope: Scope): CommandRuntimeContext {
  return {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    systemActor: true,
  }
}

function pickupWindow(daysAhead: number, hour: number): { start: string; end: string } {
  const start = new Date()
  start.setDate(start.getDate() + daysAhead)
  start.setHours(hour, 0, 0, 0)
  const end = new Date(start)
  end.setHours(hour + 4)
  return { start: start.toISOString(), end: end.toISOString() }
}

async function ensureDispatcherRole(em: EntityManager, scope: Scope, log: Log): Promise<void> {
  await ensureRoles(em, { roleNames: [LOGISTICS_DISPATCHER_ROLE], tenantId: scope.tenantId })
  log(`role "${LOGISTICS_DISPATCHER_ROLE}" ensured`)
}

async function ensureResourceTypes(em: EntityManager, bus: CommandBus, container: AwilixContainer, scope: Scope, log: Log): Promise<Map<string, string>> {
  const ids = new Map<string, string>()
  for (const type of RESOURCE_TYPES) {
    const existing = await findOneWithDecryption(em, ResourcesResourceType, { name: type.name, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }, undefined, scope)
    if (existing) {
      ids.set(type.name, existing.id)
      continue
    }
    const { result } = await bus.execute<Record<string, unknown>, { resourceTypeId: string }>('resources.resourceTypes.create', {
      input: { tenantId: scope.tenantId, organizationId: scope.organizationId, ...type },
      ctx: buildCommandContext(container, scope),
    })
    ids.set(type.name, result.resourceTypeId)
    log(`resource type "${type.name}" created`)
  }
  return ids
}

async function ensureAvailabilityRuleSet(em: EntityManager, bus: CommandBus, container: AwilixContainer, scope: Scope, log: Log): Promise<string> {
  const name = 'Pn–Pt 06:00–18:00'
  const existing = await findOneWithDecryption(em, PlannerAvailabilityRuleSet, { name, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }, undefined, scope)
  if (existing) return existing.id
  const { result } = await bus.execute<Record<string, unknown>, { ruleSetId: string }>('planner.availability-rule-sets.create', {
    input: { tenantId: scope.tenantId, organizationId: scope.organizationId, name, description: 'Standardowe okno pracy floty i kierowców.', timezone: TIMEZONE },
    ctx: buildCommandContext(container, scope),
  })
  await bus.execute('planner.availability.weekly.replace', {
    input: {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      subjectType: 'ruleset',
      subjectId: result.ruleSetId,
      timezone: TIMEZONE,
      windows: WORKING_WEEKDAYS.map((weekday) => ({ weekday, start: '06:00', end: '18:00' })),
    },
    ctx: buildCommandContext(container, scope),
  })
  log(`availability rule set "${name}" created`)
  return result.ruleSetId
}

async function ensureVehicles(em: EntityManager, bus: CommandBus, container: AwilixContainer, scope: Scope, typeIds: Map<string, string>, ruleSetId: string, log: Log): Promise<void> {
  for (const vehicle of VEHICLES) {
    const vehicleFields = { plate_number: vehicle.plate, max_weight_kg: vehicle.maxWeightKg, home_base_city: vehicle.homeBase, vehicle_status: vehicle.status }
    const existing = await findOneWithDecryption(em, ResourcesResource, { name: vehicle.name, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }, undefined, scope)
    if (existing) {
      await (container.resolve('dataEngine') as DataEngine).setCustomFields({ entityId: E.resources.resources_resource, recordId: existing.id, tenantId: scope.tenantId, organizationId: scope.organizationId, values: vehicleFields, notify: false })
      log(`vehicle "${vehicle.name}" custom fields refreshed`)
      continue
    }
    await bus.execute('resources.resources.create', {
      input: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        name: vehicle.name,
        description: `${vehicle.typeName}, baza ${vehicle.homeBase}`,
        resourceTypeId: typeIds.get(vehicle.typeName),
        capacity: vehicle.capacity,
        availabilityRuleSetId: ruleSetId,
        isActive: vehicle.status !== 'maintenance',
        customFields: {
          plate_number: vehicle.plate,
          max_weight_kg: vehicle.maxWeightKg,
          home_base_city: vehicle.homeBase,
          vehicle_status: vehicle.status,
        },
      },
      ctx: buildCommandContext(container, scope),
    })
    log(`vehicle "${vehicle.name}" created`)
  }
}

async function ensureDrivers(em: EntityManager, bus: CommandBus, container: AwilixContainer, scope: Scope, ruleSetId: string, log: Log): Promise<void> {
  const teamName = 'Kierowcy'
  let team = await findOneWithDecryption(em, StaffTeam, { name: teamName, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }, undefined, scope)
  if (!team) {
    const { result } = await bus.execute<Record<string, unknown>, { teamId: string }>('staff.teams.create', {
      input: { tenantId: scope.tenantId, organizationId: scope.organizationId, name: teamName, description: 'Kierowcy floty własnej.' },
      ctx: buildCommandContext(container, scope),
    })
    team = await findOneWithDecryption(em, StaffTeam, { id: result.teamId }, undefined, scope)
    log(`team "${teamName}" created`)
  }
  for (const driver of DRIVERS) {
    const driverFields = { driver_phone: driver.phone, license_categories: driver.licenses, driver_status: driver.status }
    const existing = await findOneWithDecryption(em, StaffTeamMember, { displayName: driver.displayName, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }, undefined, scope)
    if (existing) {
      await (container.resolve('dataEngine') as DataEngine).setCustomFields({ entityId: E.staff.staff_team_member, recordId: existing.id, tenantId: scope.tenantId, organizationId: scope.organizationId, values: driverFields, notify: false })
      log(`driver "${driver.displayName}" custom fields refreshed`)
      continue
    }
    await bus.execute('staff.team-members.create', {
      input: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        displayName: driver.displayName,
        teamId: team?.id,
        availabilityRuleSetId: ruleSetId,
        isActive: driver.status !== 'off_duty',
        customFields: {
          driver_phone: driver.phone,
          license_categories: driver.licenses,
          driver_status: driver.status,
        },
      },
      ctx: buildCommandContext(container, scope),
    })
    log(`driver "${driver.displayName}" created`)
  }
}

async function ensureTag(em: EntityManager, bus: CommandBus, container: AwilixContainer, scope: Scope, slug: string, label: string, color: string): Promise<string> {
  const existing = await findOneWithDecryption(em, CustomerTag, { slug, tenantId: scope.tenantId, organizationId: scope.organizationId }, undefined, scope)
  if (existing) return existing.id
  const { result } = await bus.execute<Record<string, unknown>, { tagId?: string; id?: string }>('customers.tags.create', {
    input: { tenantId: scope.tenantId, organizationId: scope.organizationId, slug, label, color },
    ctx: buildCommandContext(container, scope),
  })
  const created = await findOneWithDecryption(em, CustomerTag, { slug, tenantId: scope.tenantId, organizationId: scope.organizationId }, undefined, scope)
  return created?.id ?? result.tagId ?? result.id ?? ''
}

async function ensureCompanies(em: EntityManager, bus: CommandBus, container: AwilixContainer, scope: Scope, log: Log): Promise<Map<string, string>> {
  const clientTag = await ensureTag(em, bus, container, scope, 'klient', 'Klient', '#2563eb')
  const carrierTag = await ensureTag(em, bus, container, scope, 'przewoznik', 'Przewoźnik', '#f59e0b')
  const entityIds = new Map<string, string>()

  // display_name is encrypted at rest, so match in memory after decryption.
  const allCompanies = await findWithDecryption(em, CustomerEntity, { kind: 'company', tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }, { orderBy: { createdAt: 'asc' } }, scope)
  const findCompany = async (displayName: string) => allCompanies.find((company) => company.displayName === displayName) ?? null

  for (const client of CLIENTS) {
    const existing = await findCompany(client.displayName)
    if (existing) {
      entityIds.set(client.displayName, existing.id)
      continue
    }
    const { result } = await bus.execute<Record<string, unknown>, { entityId: string }>('customers.companies.create', {
      input: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        displayName: client.displayName,
        primaryEmail: client.primaryEmail,
        industry: client.industry,
        tags: clientTag ? [clientTag] : undefined,
        customFields: { is_carrier: false },
      },
      ctx: buildCommandContext(container, scope),
    })
    entityIds.set(client.displayName, result.entityId)
    log(`client "${client.displayName}" created`)
  }

  for (const carrier of CARRIERS) {
    const existing = await findCompany(carrier.displayName)
    if (existing) {
      entityIds.set(carrier.displayName, existing.id)
      continue
    }
    const { result } = await bus.execute<Record<string, unknown>, { entityId: string }>('customers.companies.create', {
      input: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        displayName: carrier.displayName,
        primaryEmail: carrier.primaryEmail,
        industry: 'Transport',
        tags: carrierTag ? [carrierTag] : undefined,
        customFields: {
          is_carrier: true,
          carrier_rating: carrier.rating,
          carrier_rate_per_km: carrier.ratePerKm,
          carrier_negotiable: carrier.negotiable,
          carrier_vehicle_types: carrier.vehicleTypes,
        },
      },
      ctx: buildCommandContext(container, scope),
    })
    entityIds.set(carrier.displayName, result.entityId)
    log(`carrier "${carrier.displayName}" created`)
  }
  return entityIds
}

async function findOrderStatusEntryId(em: EntityManager, scope: Scope, value: string): Promise<string | undefined> {
  const dictionary = await findOneWithDecryption(em, Dictionary, { key: 'sales.order_status', tenantId: scope.tenantId, organizationId: scope.organizationId }, undefined, scope)
  if (!dictionary) return undefined
  const entry = await findOneWithDecryption(em, DictionaryEntry, { dictionary: dictionary.id, value, tenantId: scope.tenantId, organizationId: scope.organizationId }, undefined, scope)
  return entry?.id
}

async function ensureTransportJobs(em: EntityManager, bus: CommandBus, container: AwilixContainer, scope: Scope, companyIds: Map<string, string>, log: Log): Promise<void> {
  // Idempotency: a job is identified by its pickup + delivery address pair.
  const liveOrderIds = new Set((await em.find(SalesOrder, { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }, { fields: ['id'] })).map((order) => order.id))
  const cfRows = await em.find(CustomFieldValue, { entityId: E.sales.sales_order, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null, fieldKey: { $in: ['pickup_address', 'delivery_address'] } })
  const byRecord = new Map<string, { pickup?: string; delivery?: string }>()
  for (const row of cfRows) {
    if (!liveOrderIds.has(row.recordId)) continue
    const bucket = byRecord.get(row.recordId) ?? {}
    if (row.fieldKey === 'pickup_address') bucket.pickup = row.valueText ?? undefined
    if (row.fieldKey === 'delivery_address') bucket.delivery = row.valueText ?? undefined
    byRecord.set(row.recordId, bucket)
  }
  const existingPairs = new Set([...byRecord.values()].map((b) => `${b.pickup}→${b.delivery}`))
  const statusEntryId = await findOrderStatusEntryId(em, scope, 'draft')
  for (const job of TRANSPORT_JOBS) {
    if (existingPairs.has(`${job.pickup}→${job.delivery}`)) {
      log(`transport job ${job.pickup.split(',').pop()?.trim()} → ${job.delivery.split(',').pop()?.trim()} already present, skipping`)
      continue
    }
    const window = pickupWindow(job.pickupInDays, job.pickupHour)
    await bus.execute('sales.orders.create', {
      input: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        currencyCode: CURRENCY,
        customerEntityId: companyIds.get(job.clientName),
        statusEntryId,
        lines: [
          {
            currencyCode: CURRENCY,
            kind: 'service',
            name: `Transport ${job.pickup.split(',').pop()?.trim()} → ${job.delivery.split(',').pop()?.trim()}`,
            quantity: 1,
            unitPriceNet: job.clientPrice,
          },
        ],
        customFields: {
          pickup_address: job.pickup,
          delivery_address: job.delivery,
          pickup_window_start: window.start,
          pickup_window_end: window.end,
          cargo_pallets: job.pallets,
          cargo_weight_kg: job.weightKg,
          client_price: job.clientPrice,
          max_carrier_cost: job.maxCarrierCost,
          dispatch_mode: 'unassigned',
        },
      },
      ctx: buildCommandContext(container, scope),
    })
    log(`transport job for "${job.clientName}" (${job.pallets} pallets) created`)
  }
}

export async function seedLogisticsExamples(
  em: EntityManager,
  container: AwilixContainer,
  scope: LogisticsSeedScope,
  options: LogisticsSeedOptions = {},
): Promise<void> {
  const log: Log = options.logger ?? (() => undefined)
  const bus = container.resolve('commandBus') as CommandBus

  await ensureDispatcherRole(em, scope, log)
  const typeIds = await ensureResourceTypes(em, bus, container, scope, log)
  const ruleSetId = await ensureAvailabilityRuleSet(em, bus, container, scope, log)
  await ensureVehicles(em, bus, container, scope, typeIds, ruleSetId, log)
  await ensureDrivers(em, bus, container, scope, ruleSetId, log)
  const companyIds = await ensureCompanies(em, bus, container, scope, log)
  await ensureTransportJobs(em, bus, container, scope, companyIds, log)
  log('logistics demo data ready')
}
