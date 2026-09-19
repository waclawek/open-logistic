import { Migration } from '@mikro-orm/migrations';

export class Migration20260919152347_logistics extends Migration {

  override name = 'Migration20260919152347_logistics';

  override up(): void | Promise<void> {
    this.addSql(`alter table "logistics_transport_jobs" add "cancellation_reason" text null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "logistics_transport_jobs" drop column "cancellation_reason";`);
  }

}
