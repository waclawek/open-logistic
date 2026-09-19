import { Migration } from '@mikro-orm/migrations';

export class Migration20260919130015_logistics extends Migration {

  override name = 'Migration20260919130015_logistics';

  override up(): void | Promise<void> {
    this.addSql(`create table "logistics_command_receipts" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "actor_user_id" uuid not null, "request_id" uuid not null, "action" text not null, "input_digest" text not null, "committed_at" timestamptz not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "logistics_command_receipts" add constraint "logistics_receipt_key_unique" unique ("tenant_id", "organization_id", "actor_user_id", "action", "request_id");`);

    this.addSql(`create table "logistics_command_results" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "receipt_id" uuid not null, "sequence" int not null, "entity_type" text not null, "record_id" uuid not null, "record_updated_at" timestamptz not null, "plan_revision" int null, "fact_revision" int null, "ledger_revision" int null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "logistics_command_results" add constraint "logistics_receipt_result_unique" unique ("tenant_id", "organization_id", "receipt_id", "sequence");`);
  }

}
