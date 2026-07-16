import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Stage 5A.1: the inventory bounded-context domain tables. Additive only —
 * no Stage 3/4A/4B table, column, index, or row is touched. Cross-module
 * references to `trading_card_variant` (owned by the `trading-cards`
 * module) are plain, non-FK `trading_card_variant_id` text columns,
 * mirroring how Stage 3 avoids in-DB FKs to Medusa's own Product module —
 * existence is validated by a workflow that resolves the trading-cards
 * module service, not by a Postgres foreign key across module boundaries.
 */
export class Migration20260716090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "trading_card_inventory_source" (
      "id" text not null,
      "display_name" text not null,
      "normalized_name" text not null,
      "provider" text check ("provider" in ('PULSE', 'OTHER')) not null,
      "language" text check ("language" in ('EN', 'JA', 'ZH')) null,
      "status" text check ("status" in ('ACTIVE', 'ARCHIVED')) not null default 'ACTIVE',
      "provider_metadata" jsonb null,
      "default_currency_code" text null,
      "default_pricing_profile_key" text null,
      "default_storefront_category_id" text null,
      "notes" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "trading_card_inventory_source_pkey" primary key ("id"),
      constraint "CK_trading_card_inventory_source_currency_format" check (default_currency_code is null or default_currency_code ~ '^[A-Z]{3}$'),
      constraint "CK_trading_card_inventory_source_notes_length" check (length(notes) <= 1000),
      constraint "CK_trading_card_inventory_source_metadata_bounded" check (provider_metadata is null or octet_length(provider_metadata::text) <= 2000)
    );`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_inventory_source_deleted_at" ON "trading_card_inventory_source" ("deleted_at") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_inventory_source_normalized_name" ON "trading_card_inventory_source" ("normalized_name") WHERE deleted_at IS NULL;`)

    this.addSql(`create table if not exists "trading_card_inventory_snapshot" (
      "id" text not null,
      "inventory_source_id" text not null,
      "status" text check ("status" in ('DRAFT', 'VALIDATED', 'PENDING_REVIEW', 'APPROVED', 'APPLYING', 'APPLIED', 'REJECTED', 'FAILED', 'SUPERSEDED')) not null default 'DRAFT',
      "sequence_number" integer not null,
      "original_filename" text null,
      "content_hash" text null,
      "row_count" integer null,
      "created_by" text not null,
      "approved_by" text null,
      "approved_at" timestamptz null,
      "rejected_by" text null,
      "rejected_at" timestamptz null,
      "rejection_reason" text null,
      "failed_at" timestamptz null,
      "failure_reason" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "trading_card_inventory_snapshot_pkey" primary key ("id"),
      constraint "CK_trading_card_inventory_snapshot_filename_length" check (length(original_filename) <= 255),
      constraint "CK_trading_card_inventory_snapshot_row_count_non_negative" check (row_count is null or row_count >= 0),
      constraint "CK_trading_card_inventory_snapshot_rejection_length" check (length(rejection_reason) <= 500),
      constraint "CK_trading_card_inventory_snapshot_failure_length" check (length(failure_reason) <= 500),
      constraint "CK_trading_card_inventory_snapshot_approved_consistency" check (
        (approved_by is null and approved_at is null) or (approved_by is not null and approved_at is not null)
      ),
      constraint "CK_trading_card_inventory_snapshot_rejected_consistency" check (
        (rejected_by is null and rejected_at is null) or (rejected_by is not null and rejected_at is not null)
      )
    );`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_inventory_snapshot_deleted_at" ON "trading_card_inventory_snapshot" ("deleted_at") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_inventory_snapshot_source_id" ON "trading_card_inventory_snapshot" ("inventory_source_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_inventory_snapshot_sequence" ON "trading_card_inventory_snapshot" ("inventory_source_id", "sequence_number") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_inventory_snapshot_live_content_hash" ON "trading_card_inventory_snapshot" ("inventory_source_id", "content_hash") WHERE content_hash IS NOT NULL AND deleted_at IS NULL AND status NOT IN ('REJECTED', 'FAILED');`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_inventory_snapshot_single_applying" ON "trading_card_inventory_snapshot" ("inventory_source_id") WHERE status = 'APPLYING' AND deleted_at IS NULL;`)

    this.addSql(`create table if not exists "trading_card_inventory_holding" (
      "id" text not null,
      "inventory_source_id" text not null,
      "trading_card_variant_id" text not null,
      "status" text check ("status" in ('DRAFT', 'READY', 'ARCHIVED')) not null default 'DRAFT',
      "quantity" integer not null default 0,
      "currency_code" text null,
      "unit_acquisition_cost" numeric null,
      "raw_unit_acquisition_cost" jsonb null,
      "unit_market_price" numeric null,
      "raw_unit_market_price" jsonb null,
      "unit_selling_price" numeric null,
      "raw_unit_selling_price" jsonb null,
      "provider_reference" text null,
      "source_observed_at" timestamptz null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "trading_card_inventory_holding_pkey" primary key ("id"),
      constraint "CK_trading_card_inventory_holding_quantity_non_negative" check (quantity >= 0),
      constraint "CK_trading_card_inventory_holding_currency_format" check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
      constraint "CK_trading_card_inventory_holding_amounts_require_currency" check (
        (unit_acquisition_cost is null and unit_market_price is null and unit_selling_price is null) or currency_code is not null
      ),
      constraint "CK_trading_card_inventory_holding_provider_reference_length" check (length(provider_reference) <= 255)
    );`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_inventory_holding_deleted_at" ON "trading_card_inventory_holding" ("deleted_at") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_inventory_holding_source_id" ON "trading_card_inventory_holding" ("inventory_source_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_inventory_holding_variant" ON "trading_card_inventory_holding" ("trading_card_variant_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_inventory_holding_source_variant" ON "trading_card_inventory_holding" ("inventory_source_id", "trading_card_variant_id") WHERE deleted_at IS NULL;`)

    this.addSql(`create table if not exists "trading_card_inventory_proposal" (
      "id" text not null,
      "inventory_source_id" text not null,
      "inventory_snapshot_id" text null,
      "trading_card_variant_id" text null,
      "provider_reference" text null,
      "provider_reference_type" text check ("provider_reference_type" in ('PULSE_PRODUCT_ID', 'SKU', 'BARCODE', 'OTHER')) null,
      "proposed_quantity" integer null,
      "previous_quantity" integer null,
      "currency_code" text null,
      "proposed_unit_acquisition_cost" numeric null,
      "raw_proposed_unit_acquisition_cost" jsonb null,
      "proposed_unit_market_price" numeric null,
      "raw_proposed_unit_market_price" jsonb null,
      "proposed_unit_selling_price" numeric null,
      "raw_proposed_unit_selling_price" jsonb null,
      "change_kind" text check ("change_kind" in ('NEW_HOLDING', 'QUANTITY_CHANGE', 'COST_CHANGE', 'PRICE_CHANGE', 'NO_CHANGE', 'UNRESOLVED_VARIANT')) not null,
      "review_status" text check ("review_status" in ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED')) not null default 'PENDING',
      "resolved_by" text null,
      "resolved_at" timestamptz null,
      "rejection_reason" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "trading_card_inventory_proposal_pkey" primary key ("id"),
      constraint "CK_trading_card_inventory_proposal_quantities_non_negative" check (
        (proposed_quantity is null or proposed_quantity >= 0) and (previous_quantity is null or previous_quantity >= 0)
      ),
      constraint "CK_trading_card_inventory_proposal_currency_format" check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
      constraint "CK_trading_card_inventory_proposal_amounts_require_currency" check (
        (proposed_unit_acquisition_cost is null and proposed_unit_market_price is null and proposed_unit_selling_price is null) or currency_code is not null
      ),
      constraint "CK_trading_card_inventory_proposal_provider_reference_length" check (length(provider_reference) <= 255),
      constraint "CK_trading_card_inventory_proposal_rejection_length" check (length(rejection_reason) <= 500),
      constraint "CK_trading_card_inventory_proposal_resolved_consistency" check (
        (resolved_by is null and resolved_at is null) or (resolved_by is not null and resolved_at is not null)
      ),
      constraint "CK_trading_card_inventory_proposal_unresolved_variant_kind" check (
        trading_card_variant_id is not null or change_kind = 'UNRESOLVED_VARIANT'
      )
    );`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_inventory_proposal_deleted_at" ON "trading_card_inventory_proposal" ("deleted_at") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_inventory_proposal_source_id" ON "trading_card_inventory_proposal" ("inventory_source_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_inventory_proposal_snapshot_id" ON "trading_card_inventory_proposal" ("inventory_snapshot_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_inventory_proposal_variant" ON "trading_card_inventory_proposal" ("trading_card_variant_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_inventory_proposal_pending_reference" ON "trading_card_inventory_proposal" ("inventory_snapshot_id", "provider_reference") WHERE review_status = 'PENDING' AND provider_reference IS NOT NULL AND deleted_at IS NULL;`)

    this.addSql(`create table if not exists "trading_card_inventory_transaction" (
      "id" text not null,
      "trading_card_variant_id" text not null,
      "inventory_source_id" text null,
      "inventory_holding_id" text null,
      "inventory_snapshot_id" text null,
      "quantity_before" integer not null,
      "quantity_after" integer not null,
      "quantity_delta" integer not null,
      "reason" text check ("reason" in ('APPROVED_SOURCE_SNAPSHOT', 'WEBSITE_SALE', 'EBAY_SALE', 'ORDER_CANCELLATION', 'REFUND_RESTOCK', 'CONTROLLED_RECONCILIATION', 'MIGRATION_OPENING_BALANCE')) not null,
      "originating_reference" text null,
      "actor" text not null,
      "idempotency_key" text null,
      "note" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "trading_card_inventory_transaction_pkey" primary key ("id"),
      constraint "CK_trading_card_inventory_transaction_quantities_non_negative" check (quantity_before >= 0 and quantity_after >= 0),
      constraint "CK_trading_card_inventory_transaction_delta_consistency" check (quantity_after = quantity_before + quantity_delta),
      constraint "CK_trading_card_inventory_transaction_originating_reference_length" check (length(originating_reference) <= 255),
      constraint "CK_trading_card_inventory_transaction_note_length" check (length(note) <= 500)
    );`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_inventory_transaction_deleted_at" ON "trading_card_inventory_transaction" ("deleted_at") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_inventory_transaction_variant" ON "trading_card_inventory_transaction" ("trading_card_variant_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_inventory_transaction_source" ON "trading_card_inventory_transaction" ("inventory_source_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_inventory_transaction_idempotency_key" ON "trading_card_inventory_transaction" ("idempotency_key") WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;`)

    this.addSql(`create table if not exists "trading_card_inventory_audit_entry" (
      "id" text not null,
      "actor" text not null,
      "entity_type" text check ("entity_type" in ('INVENTORY_SOURCE', 'INVENTORY_SNAPSHOT', 'INVENTORY_HOLDING', 'INVENTORY_PROPOSAL')) not null,
      "entity_id" text not null,
      "action" text check ("action" in ('SOURCE_CREATED', 'SOURCE_RENAMED', 'SOURCE_ARCHIVED', 'SOURCE_RESTORED', 'SNAPSHOT_CREATED', 'SNAPSHOT_STATUS_CHANGED', 'HOLDING_CREATED', 'HOLDING_QUANTITY_CHANGED', 'HOLDING_STATUS_CHANGED', 'PROPOSAL_CREATED', 'PROPOSAL_STATUS_CHANGED')) not null,
      "old_value" jsonb null,
      "new_value" jsonb null,
      "reason" text null,
      "source" text check ("source" in ('MANUAL', 'PULSE', 'SYSTEM')) not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "trading_card_inventory_audit_entry_pkey" primary key ("id"),
      constraint "CK_trading_card_inventory_audit_reason_length" check (length(reason) <= 500)
    );`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_inventory_audit_entry_deleted_at" ON "trading_card_inventory_audit_entry" ("deleted_at") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_inventory_audit_entity" ON "trading_card_inventory_audit_entry" ("entity_type", "entity_id") WHERE deleted_at IS NULL;`)

    // Each FK add is preceded by a conditional drop so `up()` is idempotent
    // (safe to reapply on an already-migrated database), matching the
    // pattern used to widen CHECK constraints in Stage 4B's Migration20260715120000.
    this.addSql(`alter table if exists "trading_card_inventory_snapshot" drop constraint if exists "trading_card_inventory_snapshot_source_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot" add constraint "trading_card_inventory_snapshot_source_id_foreign" foreign key ("inventory_source_id") references "trading_card_inventory_source" ("id") on update cascade;`)
    this.addSql(`alter table if exists "trading_card_inventory_holding" drop constraint if exists "trading_card_inventory_holding_source_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_holding" add constraint "trading_card_inventory_holding_source_id_foreign" foreign key ("inventory_source_id") references "trading_card_inventory_source" ("id") on update cascade;`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal" drop constraint if exists "trading_card_inventory_proposal_source_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal" add constraint "trading_card_inventory_proposal_source_id_foreign" foreign key ("inventory_source_id") references "trading_card_inventory_source" ("id") on update cascade;`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal" drop constraint if exists "trading_card_inventory_proposal_snapshot_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal" add constraint "trading_card_inventory_proposal_snapshot_id_foreign" foreign key ("inventory_snapshot_id") references "trading_card_inventory_snapshot" ("id") on update cascade on delete set null;`)
    this.addSql(`alter table if exists "trading_card_inventory_transaction" drop constraint if exists "trading_card_inventory_transaction_source_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_transaction" add constraint "trading_card_inventory_transaction_source_id_foreign" foreign key ("inventory_source_id") references "trading_card_inventory_source" ("id") on update cascade on delete set null;`)
    this.addSql(`alter table if exists "trading_card_inventory_transaction" drop constraint if exists "trading_card_inventory_transaction_holding_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_transaction" add constraint "trading_card_inventory_transaction_holding_id_foreign" foreign key ("inventory_holding_id") references "trading_card_inventory_holding" ("id") on update cascade on delete set null;`)
    this.addSql(`alter table if exists "trading_card_inventory_transaction" drop constraint if exists "trading_card_inventory_transaction_snapshot_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_transaction" add constraint "trading_card_inventory_transaction_snapshot_id_foreign" foreign key ("inventory_snapshot_id") references "trading_card_inventory_snapshot" ("id") on update cascade on delete set null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_snapshot" drop constraint if exists "trading_card_inventory_snapshot_source_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_holding" drop constraint if exists "trading_card_inventory_holding_source_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal" drop constraint if exists "trading_card_inventory_proposal_source_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal" drop constraint if exists "trading_card_inventory_proposal_snapshot_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_transaction" drop constraint if exists "trading_card_inventory_transaction_source_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_transaction" drop constraint if exists "trading_card_inventory_transaction_holding_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_transaction" drop constraint if exists "trading_card_inventory_transaction_snapshot_id_foreign";`)

    this.addSql(`drop table if exists "trading_card_inventory_audit_entry" cascade;`)
    this.addSql(`drop table if exists "trading_card_inventory_transaction" cascade;`)
    this.addSql(`drop table if exists "trading_card_inventory_proposal" cascade;`)
    this.addSql(`drop table if exists "trading_card_inventory_holding" cascade;`)
    this.addSql(`drop table if exists "trading_card_inventory_snapshot" cascade;`)
    this.addSql(`drop table if exists "trading_card_inventory_source" cascade;`)
  }
}
