import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260723164650 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "trading_card_inventory_snapshot_entry_override" ("id" text not null, "snapshot_entry_id" text not null, "inventory_snapshot_id" text not null, "split_group_key" text null, "requires_separate_listing_override" boolean null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "trading_card_inventory_snapshot_entry_override_pkey" primary key ("id"), constraint CK_tci_snapshot_entry_override_split_key_length check (length(split_group_key) <= 64));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_inventory_snapshot_entry_override_snapshot_entry_id" ON "trading_card_inventory_snapshot_entry_override" ("snapshot_entry_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_inventory_snapshot_entry_override_inventory_snapshot_id" ON "trading_card_inventory_snapshot_entry_override" ("inventory_snapshot_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_inventory_snapshot_entry_override_deleted_at" ON "trading_card_inventory_snapshot_entry_override" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tci_snapshot_entry_override_entry" ON "trading_card_inventory_snapshot_entry_override" ("snapshot_entry_id") WHERE deleted_at is null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tci_snapshot_entry_override_snapshot" ON "trading_card_inventory_snapshot_entry_override" ("inventory_snapshot_id") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_override" add constraint "trading_card_inventory_snapshot_entry_override_s_a2a40_foreign" foreign key ("snapshot_entry_id") references "trading_card_inventory_snapshot_entry" ("id") on update cascade;`);
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_override" add constraint "trading_card_inventory_snapshot_entry_override_i_4e903_foreign" foreign key ("inventory_snapshot_id") references "trading_card_inventory_snapshot" ("id") on update cascade;`);

    this.addSql(`alter table if exists "trading_card_inventory_audit_entry" drop constraint if exists "trading_card_inventory_audit_entry_action_check";`);

    this.addSql(`alter table if exists "trading_card_inventory_audit_entry" add constraint "trading_card_inventory_audit_entry_action_check" check("action" in ('SOURCE_CREATED', 'SOURCE_RENAMED', 'SOURCE_ARCHIVED', 'SOURCE_RESTORED', 'SNAPSHOT_CREATED', 'SNAPSHOT_STATUS_CHANGED', 'SNAPSHOT_RECONCILED', 'HOLDING_CREATED', 'HOLDING_QUANTITY_CHANGED', 'HOLDING_STATUS_CHANGED', 'PROPOSAL_CREATED', 'PROPOSAL_STATUS_CHANGED', 'PROPOSAL_REVIEWED', 'PROPOSAL_APPLICATION_ATTEMPTED', 'PROPOSAL_APPLICATION_REJECTED_STALE_BASELINE', 'PROPOSAL_APPLICATION_REJECTED_SNAPSHOT_DISCARDED', 'PROPOSAL_APPLIED', 'PROPOSAL_APPLICATION_RETRIED', 'MEDUSA_SYNC_SUCCEEDED', 'MEDUSA_SYNC_FAILED', 'MEDUSA_SYNC_RETRIED', 'IMPORT_STARTED', 'IMPORT_DUPLICATE_DETECTED', 'IMPORT_VALIDATION_FAILED', 'IMPORT_ENTRIES_PERSISTED', 'IMPORT_MATCHING_COMPLETED', 'IMPORT_RECONCILIATION_STARTED', 'IMPORT_RECONCILIATION_COMPLETED', 'IMPORT_PROPOSALS_REFRESHED', 'IMPORT_FAILED', 'PROPOSAL_VARIANT_RESOLVED', 'PROPOSAL_CATEGORY_PROPOSED', 'PROPOSAL_CATEGORY_CONFIRMED', 'PROPOSAL_SPLIT', 'ENTRY_MATCH_REMATCHED', 'PROPOSAL_SEPARATE_LISTING_OVERRIDDEN'));`);

    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry" add column if not exists "requires_separate_listing" boolean not null default false;`);

    this.addSql(`alter table if exists "trading_card_inventory_proposal" add column if not exists "proposed_ebay_store_category_id" text null, add column if not exists "proposed_category_reason" text null, add column if not exists "proposed_category_rule_id" text null, add column if not exists "confirmed_ebay_store_category_id" text null, add column if not exists "category_confirmed_at" timestamptz null, add column if not exists "category_confirmed_by" text null, add column if not exists "requires_separate_listing" boolean not null default false;`);
    this.addSql(`alter table if exists "trading_card_inventory_proposal" add constraint CK_tci_proposal_category_confirmation_consistency check((confirmed_ebay_store_category_id is null and category_confirmed_at is null and category_confirmed_by is null) or (confirmed_ebay_store_category_id is not null and category_confirmed_at is not null and category_confirmed_by is not null));`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "trading_card_inventory_snapshot_entry_override" cascade;`);

    this.addSql(`alter table if exists "trading_card_inventory_audit_entry" drop constraint if exists "trading_card_inventory_audit_entry_action_check";`);

    this.addSql(`alter table if exists "trading_card_inventory_audit_entry" add constraint "trading_card_inventory_audit_entry_action_check" check("action" in ('SOURCE_CREATED', 'SOURCE_RENAMED', 'SOURCE_ARCHIVED', 'SOURCE_RESTORED', 'SNAPSHOT_CREATED', 'SNAPSHOT_STATUS_CHANGED', 'SNAPSHOT_RECONCILED', 'HOLDING_CREATED', 'HOLDING_QUANTITY_CHANGED', 'HOLDING_STATUS_CHANGED', 'PROPOSAL_CREATED', 'PROPOSAL_STATUS_CHANGED', 'PROPOSAL_REVIEWED', 'PROPOSAL_APPLICATION_ATTEMPTED', 'PROPOSAL_APPLICATION_REJECTED_STALE_BASELINE', 'PROPOSAL_APPLICATION_REJECTED_SNAPSHOT_DISCARDED', 'PROPOSAL_APPLIED', 'PROPOSAL_APPLICATION_RETRIED', 'MEDUSA_SYNC_SUCCEEDED', 'MEDUSA_SYNC_FAILED', 'MEDUSA_SYNC_RETRIED', 'IMPORT_STARTED', 'IMPORT_DUPLICATE_DETECTED', 'IMPORT_VALIDATION_FAILED', 'IMPORT_ENTRIES_PERSISTED', 'IMPORT_MATCHING_COMPLETED', 'IMPORT_RECONCILIATION_STARTED', 'IMPORT_RECONCILIATION_COMPLETED', 'IMPORT_PROPOSALS_REFRESHED', 'IMPORT_FAILED', 'PROPOSAL_VARIANT_RESOLVED'));`);

    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry" drop column if exists "requires_separate_listing";`);

    this.addSql(`alter table if exists "trading_card_inventory_proposal" drop constraint if exists CK_tci_proposal_category_confirmation_consistency;`);
    this.addSql(`alter table if exists "trading_card_inventory_proposal" drop column if exists "proposed_ebay_store_category_id", drop column if exists "proposed_category_reason", drop column if exists "proposed_category_rule_id", drop column if exists "confirmed_ebay_store_category_id", drop column if exists "category_confirmed_at", drop column if exists "category_confirmed_by", drop column if exists "requires_separate_listing";`);
  }

}
