import { Migration } from '@mikro-orm/migrations';

export class Migration20260919151733_logistics extends Migration {

  override name = 'Migration20260919151733';

  override up(): void | Promise<void> {
    this.addSql(`create table "logistics_offers" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "reference" text not null, "customer" text not null, "origin" text not null, "destination" text not null, "pickup_date" text not null, "delivery_date" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "cargo" jsonb not null, "price_eur" double precision not null, "source" text not null, "status" text not null, "allocated_transport_id" uuid null, primary key ("id"));`);
    this.addSql(`create index "logistics_offers_scope_idx" on "logistics_offers" ("tenant_id", "organization_id", "deleted_at");`);

    this.addSql(`create table "logistics_transports" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "reference" text not null, "customer" text not null, "origin" text not null, "destination" text not null, "pickup_date" text not null, "delivery_date" text not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, "order_1" jsonb not null, "order_2" jsonb null, "additional_loads" jsonb not null, primary key ("id"));`);
    this.addSql(`create index "logistics_transports_scope_idx" on "logistics_transports" ("tenant_id", "organization_id", "deleted_at");`);
  }

}
