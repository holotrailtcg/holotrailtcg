import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Stage 1 (import identity & review corrections), alternative TCGdex match
 * selection: widens `trading_card_inventory_audit_entry`'s action check
 * constraint for the new `ENTRY_MATCH_REMATCHED` action. Purely additive.
 */
export class Migration20260723110000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "trading_card_inventory_audit_entry" drop constraint if exists "trading_card_inventory_audit_entry_action_check";`)
    this.addSql(`alter table "trading_card_inventory_audit_entry" add constraint "trading_card_inventory_audit_entry_action_check"
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
        'PROPOSAL_CATEGORY_PROPOSED', 'PROPOSAL_CATEGORY_CONFIRMED',
        'PROPOSAL_SPLIT', 'ENTRY_MATCH_REMATCHED'
      ));`)
  }

  override async down(): Promise<void> {
    this.addSql(`delete from "trading_card_inventory_audit_entry" where action = 'ENTRY_MATCH_REMATCHED';`)
    this.addSql(`alter table "trading_card_inventory_audit_entry" drop constraint if exists "trading_card_inventory_audit_entry_action_check";`)
    this.addSql(`alter table "trading_card_inventory_audit_entry" add constraint "trading_card_inventory_audit_entry_action_check"
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
        'PROPOSAL_CATEGORY_PROPOSED', 'PROPOSAL_CATEGORY_CONFIRMED',
        'PROPOSAL_SPLIT'
      ));`)
  }
}
