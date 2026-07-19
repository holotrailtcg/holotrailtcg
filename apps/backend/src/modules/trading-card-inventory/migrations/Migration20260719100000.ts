import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Codex remediation: adds a PROPOSAL_APPLICATION_REJECTED_SNAPSHOT_DISCARDED
 * audit action, written by `applyInventoryProposal` when a concurrent (or
 * prior) discard of the proposal's snapshot blocks the apply attempt from
 * moving any stock — see `lockAndAssertSnapshotNotDiscarded` in service.ts.
 */
export class Migration20260719100000 extends Migration {
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
        'PROPOSAL_APPLICATION_REJECTED_SNAPSHOT_DISCARDED'
      ));`)
  }

  override async down(): Promise<void> {
    this.addSql(`delete from "trading_card_inventory_audit_entry" where action = 'PROPOSAL_APPLICATION_REJECTED_SNAPSHOT_DISCARDED';`)
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
        'MEDUSA_SYNC_FAILED', 'MEDUSA_SYNC_RETRIED', 'PROPOSAL_VARIANT_RESOLVED'
      ));`)
  }
}
