import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260716190000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_audit_entry"
      drop constraint if exists "trading_card_inventory_audit_entry_action_check";`)
    this.addSql(`alter table if exists "trading_card_inventory_audit_entry"
      add constraint "trading_card_inventory_audit_entry_action_check" check ("action" in (
        'SOURCE_CREATED', 'SOURCE_RENAMED', 'SOURCE_ARCHIVED', 'SOURCE_RESTORED', 'SNAPSHOT_CREATED',
        'SNAPSHOT_STATUS_CHANGED', 'SNAPSHOT_RECONCILED', 'HOLDING_CREATED', 'HOLDING_QUANTITY_CHANGED',
        'HOLDING_STATUS_CHANGED', 'PROPOSAL_CREATED', 'PROPOSAL_STATUS_CHANGED',
        'IMPORT_STARTED', 'IMPORT_DUPLICATE_DETECTED', 'IMPORT_VALIDATION_FAILED', 'IMPORT_ENTRIES_PERSISTED',
        'IMPORT_MATCHING_COMPLETED', 'IMPORT_RECONCILIATION_STARTED', 'IMPORT_RECONCILIATION_COMPLETED', 'IMPORT_FAILED'
      ));`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_audit_entry"
      drop constraint if exists "trading_card_inventory_audit_entry_action_check";`)
    this.addSql(`DO $$ BEGIN
      IF to_regclass('public.trading_card_inventory_audit_entry') IS NOT NULL THEN
        ALTER TABLE "trading_card_inventory_audit_entry" ADD CONSTRAINT "trading_card_inventory_audit_entry_action_check" CHECK ("action" in (
          'SOURCE_CREATED', 'SOURCE_RENAMED', 'SOURCE_ARCHIVED', 'SOURCE_RESTORED', 'SNAPSHOT_CREATED',
          'SNAPSHOT_STATUS_CHANGED', 'SNAPSHOT_RECONCILED', 'HOLDING_CREATED', 'HOLDING_QUANTITY_CHANGED',
          'HOLDING_STATUS_CHANGED', 'PROPOSAL_CREATED', 'PROPOSAL_STATUS_CHANGED'
        ));
      END IF;
    END $$;`)
  }
}
