import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/** Bounds diagnostic breadcrumbs without rewriting the generated Stage 3 migration. */
export class Migration20260714120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_external_reference" add constraint "CK_trading_card_external_reference_note_length" check (length(raw_payload_note) <= 500);`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_external_reference" drop constraint if exists "CK_trading_card_external_reference_note_length";`)
  }
}
