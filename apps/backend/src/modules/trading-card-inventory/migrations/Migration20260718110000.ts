import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Adds the card-creation claim/lease pair to InventoryProposal (guards the
 * "create a card from this unmatched Pulse row" operation, mirroring
 * medusa_sync_attempt_token's protocol), a PROPOSAL_VARIANT_RESOLVED audit
 * action, and a MANUAL matched_via value (set when a reviewer manually
 * resolves a proposal to a variant rather than automatic Pulse matching).
 */
export class Migration20260718110000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      add column if not exists "card_creation_claim_token" text null,
      add column if not exists "card_creation_claimed_at" timestamptz null;`)

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

    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_match"
      drop constraint if exists "trading_card_inventory_snapshot_entry_match_matched_via_check";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_match"
      add constraint "trading_card_inventory_snapshot_entry_match_matched_via_check"
      check (matched_via in ('TRUSTED_REFERENCE', 'UNIQUE_ATTRIBUTE_MATCH', 'MANUAL', 'NONE'));`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_match"
      drop constraint if exists "trading_card_inventory_snapshot_entry_match_matched_via_check";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_match"
      add constraint "trading_card_inventory_snapshot_entry_match_matched_via_check"
      check (matched_via in ('TRUSTED_REFERENCE', 'UNIQUE_ATTRIBUTE_MATCH', 'NONE'));`)

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
        'MEDUSA_SYNC_FAILED', 'MEDUSA_SYNC_RETRIED'
      ));`)

    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      drop column if exists "card_creation_claim_token",
      drop column if exists "card_creation_claimed_at";`)
  }
}
