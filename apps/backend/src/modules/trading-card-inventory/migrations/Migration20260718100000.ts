import { Migration } from "@medusajs/framework/mikro-orm/migrations"

const ACTIONS_BEFORE_SYNC_RETRY = [
  "SOURCE_CREATED", "SOURCE_RENAMED", "SOURCE_ARCHIVED", "SOURCE_RESTORED", "SNAPSHOT_CREATED",
  "SNAPSHOT_STATUS_CHANGED", "SNAPSHOT_RECONCILED", "HOLDING_CREATED", "HOLDING_QUANTITY_CHANGED",
  "HOLDING_STATUS_CHANGED", "PROPOSAL_CREATED", "PROPOSAL_STATUS_CHANGED", "IMPORT_STARTED",
  "IMPORT_DUPLICATE_DETECTED", "IMPORT_VALIDATION_FAILED", "IMPORT_ENTRIES_PERSISTED",
  "IMPORT_MATCHING_COMPLETED", "IMPORT_RECONCILIATION_STARTED", "IMPORT_RECONCILIATION_COMPLETED",
  "IMPORT_FAILED", "IMPORT_PROPOSALS_REFRESHED", "PROPOSAL_REVIEWED", "PROPOSAL_APPLICATION_ATTEMPTED",
  "PROPOSAL_APPLICATION_REJECTED_STALE_BASELINE", "PROPOSAL_APPLIED", "PROPOSAL_APPLICATION_RETRIED",
  "MEDUSA_SYNC_SUCCEEDED", "MEDUSA_SYNC_FAILED",
] as const

function actionConstraint(actions: readonly string[]): string {
  return actions.map((action) => `'${action}'`).join(", ")
}

/** Review fix: record the distinct fact that a failed downstream sync was retried. */
export class Migration20260718100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_audit_entry"
      drop constraint if exists "trading_card_inventory_audit_entry_action_check";`)
    this.addSql(`alter table if exists "trading_card_inventory_audit_entry"
      add constraint "trading_card_inventory_audit_entry_action_check"
      check ("action" in (${actionConstraint([...ACTIONS_BEFORE_SYNC_RETRY, "MEDUSA_SYNC_RETRIED"])}));`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_audit_entry"
      drop constraint if exists "trading_card_inventory_audit_entry_action_check";`)
    this.addSql(`alter table if exists "trading_card_inventory_audit_entry"
      add constraint "trading_card_inventory_audit_entry_action_check"
      check ("action" in (${actionConstraint(ACTIONS_BEFORE_SYNC_RETRY)}));`)
  }
}
