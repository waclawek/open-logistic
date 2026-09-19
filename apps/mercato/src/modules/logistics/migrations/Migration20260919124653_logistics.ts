import { Migration } from '@mikro-orm/migrations';

export class Migration20260919124653_logistics extends Migration {

  override name = 'Migration20260919124653_logistics';

  override up(): void | Promise<void> {
    this.addSql(`create table "logistics_driver_profiles" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "staff_member_id" uuid not null, "dispatch_enabled" boolean not null default false, "dispatcher_notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "logistics_driver_scope_idx" on "logistics_driver_profiles" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "logistics_driver_profiles" add constraint "logistics_driver_staff_unique" unique ("tenant_id", "organization_id", "staff_member_id");`);

    this.addSql(`create table "logistics_transport_jobs" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "reference" text not null, "customer_id" uuid not null, "customer_name_snapshot" text not null, "customer_reference" text null, "cargo_description" text not null, "weight_kg" numeric(12,3) not null, "is_palletized" boolean not null, "pallets" int null, "pickup_place" jsonb not null, "delivery_place" jsonb not null, "pickup_window_start" timestamptz not null, "pickup_window_end" timestamptz not null, "delivery_window_start" timestamptz not null, "delivery_window_end" timestamptz not null, "status" text not null default 'draft', "accepted_at" timestamptz null, "first_assigned_at" timestamptz null, "terminal_at" timestamptz null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "logistics_job_queue_idx" on "logistics_transport_jobs" ("tenant_id", "organization_id", "status", "created_at", "id");`);
    this.addSql(`alter table "logistics_transport_jobs" add constraint "logistics_job_reference_unique" unique ("tenant_id", "organization_id", "reference");`);
    this.addSql(`alter table "logistics_transport_jobs" add constraint "logistics_job_status_check" check (status IN ('draft', 'ready', 'assigned', 'in_transit', 'delivered', 'returned', 'cancelled'));`);
    this.addSql(`alter table "logistics_transport_jobs" add constraint "logistics_job_windows_check" check (pickup_window_start <= pickup_window_end AND delivery_window_start <= delivery_window_end AND pickup_window_start <= delivery_window_end);`);
    this.addSql(`alter table "logistics_transport_jobs" add constraint "logistics_job_cargo_check" check (weight_kg > 0 AND ((is_palletized = true AND pallets IS NOT NULL AND pallets > 0) OR (is_palletized = false AND pallets IS NULL)));`);

    this.addSql(`create table "logistics_vehicle_profiles" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "resource_id" uuid not null, "registration" text not null, "registration_hash" text not null, "max_payload_kg" numeric(12,3) not null, "max_pallets" int null, "dispatch_enabled" boolean not null default false, "last_known_place" jsonb null, "last_known_at" timestamptz null, "last_known_source" text null, "ledger_revision" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "logistics_vehicle_scope_idx" on "logistics_vehicle_profiles" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "logistics_vehicle_profiles" add constraint "logistics_vehicle_registration_unique" unique ("tenant_id", "organization_id", "registration_hash");`);
    this.addSql(`alter table "logistics_vehicle_profiles" add constraint "logistics_vehicle_resource_unique" unique ("tenant_id", "organization_id", "resource_id");`);
    this.addSql(`alter table "logistics_vehicle_profiles" add constraint "logistics_vehicle_location_check" check ((last_known_place IS NULL AND last_known_at IS NULL AND last_known_source IS NULL) OR (last_known_place IS NOT NULL AND last_known_at IS NOT NULL AND last_known_source IS NOT NULL AND last_known_source IN ('stop_report', 'manual_confirmation')));`);
    this.addSql(`alter table "logistics_vehicle_profiles" add constraint "logistics_vehicle_ledger_check" check (ledger_revision >= 0);`);
    this.addSql(`alter table "logistics_vehicle_profiles" add constraint "logistics_vehicle_capacity_check" check (max_payload_kg > 0 AND (max_pallets IS NULL OR max_pallets >= 0));`);
  }

}
