import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Stage 1 (import identity & review corrections), split-group workflow:
 * adds `trading_card_inventory_snapshot_entry_override` — the mutable
 * per-entry correction table backing both the split-group workflow
 * (`split_group_key`) and the requires-separate-listing review override
 * (`requires_separate_listing_override`, wired up in a later commit).
 * Purely additive; existing tables/rows are untouched.
 */
export class Migration20260723090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "trading_card_inventory_snapshot_entry_override" (
      "id" text not null,
      "snapshot_entry_id" text not null,
      "inventory_snapshot_id" text not null,
      "split_group_key" text null,
      "requires_separate_listing_override" boolean null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "trading_card_inventory_snapshot_entry_override_pkey" primary key ("id"),
      constraint "CK_tci_snapshot_entry_override_split_key_length" check (length(split_group_key) <= 64)
    );`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_override"
      drop constraint if exists "trading_card_inventory_snapshot_entry_override_entry_fk";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_override"
      add constraint "trading_card_inventory_snapshot_entry_override_entry_fk"
      foreign key ("snapshot_entry_id") references "trading_card_inventory_snapshot_entry" ("id") on update cascade;`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_override"
      drop constraint if exists "trading_card_inventory_snapshot_entry_override_snapshot_fk";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_override"
      add constraint "trading_card_inventory_snapshot_entry_override_snapshot_fk"
      foreign key ("inventory_snapshot_id") references "trading_card_inventory_snapshot" ("id") on update cascade;`)
    this.addSql(`create unique index if not exists "IDX_tci_snapshot_entry_override_entry"
      on "trading_card_inventory_snapshot_entry_override" ("snapshot_entry_id") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_tci_snapshot_entry_override_snapshot"
      on "trading_card_inventory_snapshot_entry_override" ("inventory_snapshot_id");`)

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

  override async down(): Promise<void> {
    this.addSql(`delete from "trading_card_inventory_audit_entry" where action = 'PROPOSAL_SPLIT';`)
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
        'PROPOSAL_CATEGORY_PROPOSED', 'PROPOSAL_CATEGORY_CONFIRMED'
      ));`)
    this.addSql(`drop table if exists "trading_card_inventory_snapshot_entry_override" cascade;`)
  }
}
