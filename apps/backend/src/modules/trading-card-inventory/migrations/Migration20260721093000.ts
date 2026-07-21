import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * E2B: category assignment fields on `trading_card_inventory_proposal`.
 * Additive and nullable — existing (historical) proposal rows are left
 * exactly as they are; no backfill.
 */
export class Migration20260721093000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      add column if not exists "proposed_ebay_store_category_id" text null,
      add column if not exists "proposed_category_reason" text null,
      add column if not exists "proposed_category_rule_id" text null,
      add column if not exists "confirmed_ebay_store_category_id" text null,
      add column if not exists "category_confirmed_at" timestamptz null,
      add column if not exists "category_confirmed_by" text null;`);
    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      add constraint "CK_tci_proposal_category_confirmation_consistency" check (
        ("confirmed_ebay_store_category_id" is null and "category_confirmed_at" is null and "category_confirmed_by" is null) or
        ("confirmed_ebay_store_category_id" is not null and "category_confirmed_at" is not null and "category_confirmed_by" is not null)
      );`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_proposal" drop constraint if exists "CK_tci_proposal_category_confirmation_consistency";`);
    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      drop column if exists "proposed_ebay_store_category_id",
      drop column if exists "proposed_category_reason",
      drop column if exists "proposed_category_rule_id",
      drop column if exists "confirmed_ebay_store_category_id",
      drop column if exists "category_confirmed_at",
      drop column if exists "category_confirmed_by";`);
  }

}
