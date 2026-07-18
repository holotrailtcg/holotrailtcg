import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/** Adds the DISCARDED terminal snapshot status (Admin-triggered manual removal of a not-yet-applied import from the working list). */
export class Migration20260717231314 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_snapshot"
      drop constraint if exists "trading_card_inventory_snapshot_status_check";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot"
      add constraint "trading_card_inventory_snapshot_status_check"
      check (status in ('DRAFT', 'VALIDATED', 'PENDING_REVIEW', 'APPROVED', 'APPLYING', 'APPLIED', 'REJECTED', 'FAILED', 'SUPERSEDED', 'DISCARDED'));`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_snapshot"
      drop constraint if exists "trading_card_inventory_snapshot_status_check";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot"
      add constraint "trading_card_inventory_snapshot_status_check"
      check (status in ('DRAFT', 'VALIDATED', 'PENDING_REVIEW', 'APPROVED', 'APPLYING', 'APPLIED', 'REJECTED', 'FAILED', 'SUPERSEDED'));`)
  }
}
