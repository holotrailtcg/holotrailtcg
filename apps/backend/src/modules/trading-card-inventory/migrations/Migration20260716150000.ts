import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260716150000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_snapshot"
      add column if not exists "reconciled_against_snapshot_id" text null,
      add column if not exists "reconciled_at" timestamptz null;`)
    this.addSql(`alter table if exists "trading_card_inventory_audit_entry"
      drop constraint if exists "trading_card_inventory_audit_entry_action_check";`)
    this.addSql(`alter table if exists "trading_card_inventory_audit_entry"
      add constraint "trading_card_inventory_audit_entry_action_check" check ("action" in (
        'SOURCE_CREATED', 'SOURCE_RENAMED', 'SOURCE_ARCHIVED', 'SOURCE_RESTORED', 'SNAPSHOT_CREATED',
        'SNAPSHOT_STATUS_CHANGED', 'SNAPSHOT_RECONCILED', 'HOLDING_CREATED', 'HOLDING_QUANTITY_CHANGED',
        'HOLDING_STATUS_CHANGED', 'PROPOSAL_CREATED', 'PROPOSAL_STATUS_CHANGED'
      ));`)

    this.addSql(`create table if not exists "trading_card_inventory_snapshot_entry" (
      "id" text not null,
      "inventory_snapshot_id" text not null,
      "provider_reference" text not null,
      "provider_reference_type" text check ("provider_reference_type" in ('PULSE_PRODUCT_ID', 'SKU', 'BARCODE', 'OTHER')) not null,
      "trading_card_variant_id" text null,
      "quantity" integer not null,
      "currency_code" text null,
      "unit_acquisition_cost" numeric null,
      "raw_unit_acquisition_cost" jsonb null,
      "unit_market_price" numeric null,
      "raw_unit_market_price" jsonb null,
      "unit_selling_price" numeric null,
      "raw_unit_selling_price" jsonb null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "trading_card_inventory_snapshot_entry_pkey" primary key ("id"),
      constraint "CK_tci_snapshot_entry_quantity_non_negative" check (quantity >= 0),
      constraint "CK_tci_snapshot_entry_reference_length" check (length(provider_reference) between 1 and 255),
      constraint "CK_tci_snapshot_entry_currency_format" check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
      constraint "CK_tci_snapshot_entry_amounts_require_currency" check (
        (unit_acquisition_cost is null and unit_market_price is null and unit_selling_price is null) or currency_code is not null
      )
    );`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tci_snapshot_entry_deleted_at" ON "trading_card_inventory_snapshot_entry" ("deleted_at") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tci_snapshot_entry_snapshot_reference" ON "trading_card_inventory_snapshot_entry" ("inventory_snapshot_id", "provider_reference_type", "provider_reference") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tci_snapshot_entry_variant" ON "trading_card_inventory_snapshot_entry" ("trading_card_variant_id") WHERE deleted_at IS NULL;`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry" drop constraint if exists "tci_snapshot_entry_snapshot_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry" add constraint "tci_snapshot_entry_snapshot_id_foreign"
      foreign key ("inventory_snapshot_id") references "trading_card_inventory_snapshot" ("id") on update cascade;`)

    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      add column if not exists "baseline_snapshot_id" text null,
      add column if not exists "reconciliation_key" text null,
      add column if not exists "quantity_delta" integer null,
      add column if not exists "previous_unit_acquisition_cost" numeric null,
      add column if not exists "raw_previous_unit_acquisition_cost" jsonb null,
      add column if not exists "previous_unit_market_price" numeric null,
      add column if not exists "raw_previous_unit_market_price" jsonb null,
      add column if not exists "previous_unit_selling_price" numeric null,
      add column if not exists "raw_previous_unit_selling_price" jsonb null,
      add column if not exists "reconciliation_reason" text null,
      add column if not exists "reconciliation_diagnostics" jsonb null,
      add column if not exists "compared_at" timestamptz null;`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal" drop constraint if exists "CK_tci_proposal_reason_length";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal" add constraint "CK_tci_proposal_reason_length"
      check (reconciliation_reason is null or length(reconciliation_reason) <= 500);`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tci_proposal_reconciliation_key" ON "trading_card_inventory_proposal"
      ("inventory_snapshot_id", "reconciliation_key") WHERE reconciliation_key IS NOT NULL AND deleted_at IS NULL;`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_trading_card_inventory_proposal_pending_reference";`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_inventory_proposal_pending_reference" ON "trading_card_inventory_proposal"
      ("inventory_snapshot_id", "provider_reference_type", "provider_reference")
      WHERE review_status = 'PENDING' AND provider_reference IS NOT NULL AND deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tci_proposal_filters" ON "trading_card_inventory_proposal"
      ("inventory_snapshot_id", "review_status", "change_kind") WHERE deleted_at IS NULL;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_audit_entry"
      drop constraint if exists "trading_card_inventory_audit_entry_action_check";`)
    this.addSql(`DO $$ BEGIN
      IF to_regclass('public.trading_card_inventory_audit_entry') IS NOT NULL THEN
        ALTER TABLE "trading_card_inventory_audit_entry" ADD CONSTRAINT "trading_card_inventory_audit_entry_action_check" CHECK ("action" in (
          'SOURCE_CREATED', 'SOURCE_RENAMED', 'SOURCE_ARCHIVED', 'SOURCE_RESTORED', 'SNAPSHOT_CREATED',
          'SNAPSHOT_STATUS_CHANGED', 'HOLDING_CREATED', 'HOLDING_QUANTITY_CHANGED', 'HOLDING_STATUS_CHANGED',
          'PROPOSAL_CREATED', 'PROPOSAL_STATUS_CHANGED'
        )) NOT VALID;
      END IF;
    END $$;`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_tci_proposal_filters";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_tci_proposal_reconciliation_key";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_trading_card_inventory_proposal_pending_reference";`)
    this.addSql(`DO $$ BEGIN
      IF to_regclass('public.trading_card_inventory_proposal') IS NOT NULL THEN
        CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_inventory_proposal_pending_reference" ON "trading_card_inventory_proposal"
          ("inventory_snapshot_id", "provider_reference") WHERE review_status = 'PENDING' AND provider_reference IS NOT NULL AND deleted_at IS NULL;
      END IF;
    END $$;`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal" drop constraint if exists "CK_tci_proposal_reason_length";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      drop column if exists "baseline_snapshot_id", drop column if exists "reconciliation_key",
      drop column if exists "quantity_delta", drop column if exists "previous_unit_acquisition_cost",
      drop column if exists "raw_previous_unit_acquisition_cost", drop column if exists "previous_unit_market_price",
      drop column if exists "raw_previous_unit_market_price", drop column if exists "previous_unit_selling_price",
      drop column if exists "raw_previous_unit_selling_price", drop column if exists "reconciliation_reason",
      drop column if exists "reconciliation_diagnostics", drop column if exists "compared_at";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry" drop constraint if exists "tci_snapshot_entry_snapshot_id_foreign";`)
    this.addSql(`drop table if exists "trading_card_inventory_snapshot_entry" cascade;`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot"
      drop column if exists "reconciled_against_snapshot_id", drop column if exists "reconciled_at";`)
  }
}
