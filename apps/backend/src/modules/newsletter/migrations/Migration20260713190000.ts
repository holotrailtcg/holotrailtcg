import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260713190000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "newsletter_subscriber" drop constraint if exists "newsletter_subscriber_confirmation_send_state_check";`);
    this.addSql(`alter table if exists "newsletter_subscriber" add constraint "newsletter_subscriber_confirmation_send_state_check" check ("confirmation_send_state" in ('NOT_SENT', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN'));`);
    this.addSql(`alter table if exists "newsletter_subscriber" add column if not exists "confirmation_send_reserved_at" timestamptz null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "newsletter_subscriber" drop column if exists "confirmation_send_reserved_at";`);
    this.addSql(`alter table if exists "newsletter_subscriber" drop constraint if exists "newsletter_subscriber_confirmation_send_state_check";`);
    this.addSql(`alter table if exists "newsletter_subscriber" add constraint "newsletter_subscriber_confirmation_send_state_check" check ("confirmation_send_state" in ('NOT_SENT', 'SENT', 'FAILED'));`);
  }

}
