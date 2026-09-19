import { Check, Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'
import type { JobStatus, Place } from './validators'
import { nextRecordVersion } from '../lib/version'

@Entity({ tableName: 'logistics_vehicle_profiles' })
@Index({ name: 'logistics_vehicle_scope_idx', properties: ['tenantId', 'organizationId'] })
@Unique({ name: 'logistics_vehicle_resource_unique', properties: ['tenantId', 'organizationId', 'resourceId'] })
@Unique({ name: 'logistics_vehicle_registration_unique', properties: ['tenantId', 'organizationId', 'registrationHash'] })
@Check({ name: 'logistics_vehicle_capacity_check', expression: 'max_payload_kg > 0 AND (max_pallets IS NULL OR max_pallets >= 0)' })
@Check({ name: 'logistics_vehicle_ledger_check', expression: 'ledger_revision >= 0' })
@Check({ name: 'logistics_vehicle_location_check', expression: "(last_known_place IS NULL AND last_known_at IS NULL AND last_known_source IS NULL) OR (last_known_place IS NOT NULL AND last_known_at IS NOT NULL AND last_known_source IS NOT NULL AND last_known_source IN ('stop_report', 'manual_confirmation'))" })
export class VehicleProfile {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'resource_id', type: 'uuid' })
  resourceId!: string

  @Property({ type: 'text' })
  registration!: string

  @Property({ name: 'registration_hash', type: 'text' })
  registrationHash!: string

  @Property({ name: 'max_payload_kg', type: 'numeric', precision: 12, scale: 3 })
  maxPayloadKg!: string

  @Property({ name: 'max_pallets', type: 'integer', nullable: true })
  maxPallets: number | null = null

  @Property({ name: 'dispatch_enabled', type: 'boolean', default: false })
  dispatchEnabled = false

  @Property({ name: 'last_known_place', type: 'json', nullable: true })
  lastKnownPlace: Place | null = null

  @Property({ name: 'last_known_at', type: Date, nullable: true })
  lastKnownAt: Date | null = null

  @Property({ name: 'last_known_source', type: 'text', nullable: true })
  lastKnownSource: 'stop_report' | 'manual_confirmation' | null = null

  @Property({ name: 'ledger_revision', type: 'integer', default: 0 })
  ledgerRevision = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: (entity: VehicleProfile) => nextRecordVersion(entity.updatedAt) })
  updatedAt = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt: Date | null = null
}

@Entity({ tableName: 'logistics_driver_profiles' })
@Index({ name: 'logistics_driver_scope_idx', properties: ['tenantId', 'organizationId'] })
@Unique({ name: 'logistics_driver_staff_unique', properties: ['tenantId', 'organizationId', 'staffMemberId'] })
export class DriverProfile {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'staff_member_id', type: 'uuid' })
  staffMemberId!: string

  @Property({ name: 'dispatch_enabled', type: 'boolean', default: false })
  dispatchEnabled = false

  @Property({ name: 'dispatcher_notes', type: 'text', nullable: true })
  dispatcherNotes: string | null = null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: (entity: DriverProfile) => nextRecordVersion(entity.updatedAt) })
  updatedAt = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt: Date | null = null
}

@Entity({ tableName: 'logistics_transport_jobs' })
@Index({ name: 'logistics_job_queue_idx', properties: ['tenantId', 'organizationId', 'status', 'createdAt', 'id'] })
@Unique({ name: 'logistics_job_reference_unique', properties: ['tenantId', 'organizationId', 'reference'] })
@Check({ name: 'logistics_job_cargo_check', expression: 'weight_kg > 0 AND ((is_palletized = true AND pallets IS NOT NULL AND pallets > 0) OR (is_palletized = false AND pallets IS NULL))' })
@Check({ name: 'logistics_job_windows_check', expression: 'pickup_window_start <= pickup_window_end AND delivery_window_start <= delivery_window_end AND pickup_window_start <= delivery_window_end' })
@Check({ name: 'logistics_job_status_check', expression: "status IN ('draft', 'ready', 'assigned', 'in_transit', 'delivered', 'returned', 'cancelled')" })
export class TransportJob {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  reference!: string

  @Property({ name: 'customer_id', type: 'uuid' })
  customerId!: string

  @Property({ name: 'customer_name_snapshot', type: 'text' })
  customerNameSnapshot!: string

  @Property({ name: 'customer_reference', type: 'text', nullable: true })
  customerReference: string | null = null

  @Property({ name: 'cargo_description', type: 'text' })
  cargoDescription!: string

  @Property({ name: 'weight_kg', type: 'numeric', precision: 12, scale: 3 })
  weightKg!: string

  @Property({ name: 'is_palletized', type: 'boolean' })
  isPalletized!: boolean

  @Property({ type: 'integer', nullable: true })
  pallets: number | null = null

  @Property({ name: 'pickup_place', type: 'json' })
  pickupPlace!: Place

  @Property({ name: 'delivery_place', type: 'json' })
  deliveryPlace!: Place

  @Property({ name: 'pickup_window_start', type: Date })
  pickupWindowStart!: Date

  @Property({ name: 'pickup_window_end', type: Date })
  pickupWindowEnd!: Date

  @Property({ name: 'delivery_window_start', type: Date })
  deliveryWindowStart!: Date

  @Property({ name: 'delivery_window_end', type: Date })
  deliveryWindowEnd!: Date

  @Property({ type: 'text', default: 'draft' })
  status: JobStatus = 'draft'

  @Property({ name: 'accepted_at', type: Date, nullable: true })
  acceptedAt: Date | null = null

  @Property({ name: 'first_assigned_at', type: Date, nullable: true })
  firstAssignedAt: Date | null = null

  @Property({ name: 'terminal_at', type: Date, nullable: true })
  terminalAt: Date | null = null

  @Property({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason: string | null = null

  @Property({ type: 'text', nullable: true })
  notes: string | null = null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: (entity: TransportJob) => nextRecordVersion(entity.updatedAt) })
  updatedAt = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt: Date | null = null
}

@Entity({ tableName: 'logistics_command_receipts' })
@Unique({ name: 'logistics_receipt_key_unique', properties: ['tenantId', 'organizationId', 'actorUserId', 'action', 'requestId'] })
export class CommandReceipt {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'actor_user_id', type: 'uuid' })
  actorUserId!: string

  @Property({ name: 'request_id', type: 'uuid' })
  requestId!: string

  @Property({ type: 'text' })
  action!: string

  @Property({ name: 'input_digest', type: 'text' })
  inputDigest!: string

  @Property({ name: 'committed_at', type: Date })
  committedAt = new Date()

  @Property({ name: 'created_at', type: Date })
  createdAt = new Date()

  @Property({ name: 'updated_at', type: Date })
  updatedAt = new Date()
}

@Entity({ tableName: 'logistics_command_results' })
@Unique({ name: 'logistics_receipt_result_unique', properties: ['tenantId', 'organizationId', 'receiptId', 'sequence'] })
export class CommandResultRecord {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'receipt_id', type: 'uuid' })
  receiptId!: string

  @Property({ type: 'integer' })
  sequence!: number

  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string

  @Property({ name: 'record_id', type: 'uuid' })
  recordId!: string

  @Property({ name: 'record_updated_at', type: Date })
  recordUpdatedAt!: Date

  @Property({ name: 'plan_revision', type: 'integer', nullable: true })
  planRevision: number | null = null

  @Property({ name: 'fact_revision', type: 'integer', nullable: true })
  factRevision: number | null = null

  @Property({ name: 'ledger_revision', type: 'integer', nullable: true })
  ledgerRevision: number | null = null

  @Property({ name: 'created_at', type: Date })
  createdAt = new Date()

  @Property({ name: 'updated_at', type: Date })
  updatedAt = new Date()
}
