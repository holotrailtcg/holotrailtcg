import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260713175132 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "newsletter_subscriber" add column if not exists "confirmation_token_consumed_hash" text null;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_newsletter_subscriber_confirmation_token_consumed_hash" ON "newsletter_subscriber" ("confirmation_token_consumed_hash") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_newsletter_subscriber_confirmation_token_consumed_hash";`);
    this.addSql(`alter table if exists "newsletter_subscriber" drop column if exists "confirmation_token_consumed_hash";`);
  }

}
