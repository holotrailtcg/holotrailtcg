import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * E2B follow-up: `Migration20260721093000` added the category-assignment
 * columns to `trading_card_inventory_proposal` and the service/type layer
 * already writes `PROPOSAL_CATEGORY_PROPOSED`/`PROPOSAL_CATEGORY_CONFIRMED`
 * audit actions (`INVENTORY_AUDIT_ACTION` in types.ts), but that migration
 * never extended this table's own action check constraint to allow either
 * value — every `confirmProposalCategory` call has been failing with a
 * `CheckConstraintViolationException` since the E2B PR merged. Confirmed via
 * `debug-confirm-proposal-category.ts` against real data (2026-07-22).
 */
export class Migration20260722120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_audit_entry"
      drop constraint if exists "trading_card_inventory_audit_entry_action_check";`)
    this.addSql(`alter table if exists "trading_card_inventory_audit_entry"
      add constraint "trading_card_inventory_audit_entry_action_check"
      check (action in (
        'SOURCE_CREATED', 'SOURCE_RENAMED', 'SOURCE_ARCHIVED', 'SOURCE_RESTORED',
        'SNAPSHOT_CREATED', 'SNAPSHOT_STATUS_CHANGED', 'SNAPSHOT_RECONCILED',
        'HOLDING_CREATED', 'HOLDING_QUANTITY_CHANGED', 'HOLDING_STATUS_CHANGED',
        'PROPOSAL_CREATED', 'PROPOSAL_STATUS_CHANGED', 'IMPORT_STARTED',
        'IMPORT_DUPLICATE_DETECTED', 'IMPORT_VALIDATION_FAILED', 'IMPORT_ENTRIES_PERSISTED',
        'IMPORT_MATCHING_COMPLETED', 'IMPORT_RECONCILIATION_STARTED', 'IMPORT_RECONCILIATION_COMPLETED',
        'IMPORT_PROPOSALS_REFRESHED', 'IMPORT_FAILED', 'PROPOSAL_REVIEWED',
        'PROPOSAL_APPLICATION_ATTEMPTED', 'PROPOSAL_APPLICATION_REJECTED_STALE_BASELINE',
        'PROPOSAL_APPLIED', 'PROPOSAL_APPLICATION_RETRIED', 'MEDUSA_SYNC_SUCCEEDED',
        'MEDUSA_SYNC_FAILED', 'MEDUSA_SYNC_RETRIED', 'PROPOSAL_VARIANT_RESOLVED',
        'PROPOSAL_APPLICATION_REJECTED_SNAPSHOT_DISCARDED',
        'PROPOSAL_CATEGORY_PROPOSED', 'PROPOSAL_CATEGORY_CONFIRMED'
      ));`)
  }

  override async down(): Promise<void> {
    this.addSql(`delete from "trading_card_inventory_audit_entry" where action in ('PROPOSAL_CATEGORY_PROPOSED', 'PROPOSAL_CATEGORY_CONFIRMED');`)
    this.addSql(`alter table if exists "trading_card_inventory_audit_entry"
      drop constraint if exists "trading_card_inventory_audit_entry_action_check";`)
    this.addSql(`alter table if exists "trading_card_inventory_audit_entry"
      add constraint "trading_card_inventory_audit_entry_action_check"
      check (action in (
        'SOURCE_CREATED', 'SOURCE_RENAMED', 'SOURCE_ARCHIVED', 'SOURCE_RESTORED',
        'SNAPSHOT_CREATED', 'SNAPSHOT_STATUS_CHANGED', 'SNAPSHOT_RECONCILED',
        'HOLDING_CREATED', 'HOLDING_QUANTITY_CHANGED', 'HOLDING_STATUS_CHANGED',
        'PROPOSAL_CREATED', 'PROPOSAL_STATUS_CHANGED', 'IMPORT_STARTED',
        'IMPORT_DUPLICATE_DETECTED', 'IMPORT_VALIDATION_FAILED', 'IMPORT_ENTRIES_PERSISTED',
        'IMPORT_MATCHING_COMPLETED', 'IMPORT_RECONCILIATION_STARTED', 'IMPORT_RECONCILIATION_COMPLETED',
        'IMPORT_PROPOSALS_REFRESHED', 'IMPORT_FAILED', 'PROPOSAL_REVIEWED',
        'PROPOSAL_APPLICATION_ATTEMPTED', 'PROPOSAL_APPLICATION_REJECTED_STALE_BASELINE',
        'PROPOSAL_APPLIED', 'PROPOSAL_APPLICATION_RETRIED', 'MEDUSA_SYNC_SUCCEEDED',
        'MEDUSA_SYNC_FAILED', 'MEDUSA_SYNC_RETRIED', 'PROPOSAL_VARIANT_RESOLVED',
        'PROPOSAL_APPLICATION_REJECTED_SNAPSHOT_DISCARDED'
      ));`)
  }
}
