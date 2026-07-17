import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Stage 5B.2: proposal review-note, application (authoritative local stock
 * movement) tracking, and Medusa inventory-sync-state tracking. Additive
 * only, plus a strengthening of the existing "resolved" consistency check
 * (previously only "both null or both set"; now also requires resolved_by/
 * resolved_at whenever review_status has left PENDING, and requires them to
 * be null while still PENDING).
 */
export class Migration20260718090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      add column if not exists "review_note" text null,
      add column if not exists "applied_at" timestamptz null,
      add column if not exists "applied_transaction_id" text null,
      add column if not exists "applied_holding_id" text null,
      add column if not exists "application_idempotency_key" text null,
      add column if not exists "medusa_sync_status" text not null default 'NOT_APPLICABLE',
      add column if not exists "medusa_inventory_item_id" text null,
      add column if not exists "medusa_stock_location_id" text null,
      add column if not exists "medusa_sync_attempted_at" timestamptz null,
      add column if not exists "medusa_sync_succeeded_at" timestamptz null,
      add column if not exists "medusa_sync_retry_count" integer not null default 0,
      add column if not exists "medusa_sync_attempt_token" text null,
      add column if not exists "medusa_sync_last_error" jsonb null;`)

    // Required before the original one-way APPLIED consistency check on a
    // fresh Stage 5B.1 database. The later review migration repeats this
    // idempotently for databases that had already recorded this migration.
    this.addSql(`update "trading_card_inventory_proposal"
      set review_status = 'APPROVED', updated_at = now()
      where review_status = 'APPLIED' and applied_at is null and applied_transaction_id is null and applied_holding_id is null;`)

    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      drop constraint if exists "CK_trading_card_inventory_proposal_resolved_consistency";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      add constraint "CK_trading_card_inventory_proposal_resolved_consistency"
      check (
        (review_status = 'PENDING' and resolved_by is null and resolved_at is null) or
        (review_status <> 'PENDING' and resolved_by is not null and resolved_at is not null)
      );`)

    this.addSql(`alter table if exists "trading_card_inventory_proposal" drop constraint if exists "CK_tci_proposal_rejection_reason_scope";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal" add constraint "CK_tci_proposal_rejection_reason_scope"
      check (rejection_reason is null or review_status = 'REJECTED');`)

    this.addSql(`alter table if exists "trading_card_inventory_proposal" drop constraint if exists "CK_tci_proposal_review_note_length";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal" add constraint "CK_tci_proposal_review_note_length"
      check (review_note is null or length(review_note) <= 500);`)

    this.addSql(`alter table if exists "trading_card_inventory_proposal" drop constraint if exists "CK_tci_proposal_applied_consistency";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal" add constraint "CK_tci_proposal_applied_consistency"
      check (
        review_status <> 'APPLIED' or
        (applied_at is not null and applied_transaction_id is not null and applied_holding_id is not null)
      );`)

    this.addSql(`alter table if exists "trading_card_inventory_proposal" drop constraint if exists "CK_tci_proposal_medusa_sync_status";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal" add constraint "CK_tci_proposal_medusa_sync_status"
      check (medusa_sync_status in ('NOT_APPLICABLE', 'PENDING', 'SYNCED', 'FAILED'));`)

    this.addSql(`alter table if exists "trading_card_inventory_proposal" drop constraint if exists "CK_tci_proposal_medusa_error_requires_failed";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal" add constraint "CK_tci_proposal_medusa_error_requires_failed"
      check (medusa_sync_last_error is null or medusa_sync_status = 'FAILED');`)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tci_proposal_medusa_sync_status" ON "trading_card_inventory_proposal"
      ("medusa_sync_status") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tci_proposal_application_idempotency_key" ON "trading_card_inventory_proposal"
      ("application_idempotency_key") WHERE application_idempotency_key IS NOT NULL AND deleted_at IS NULL;`)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_tci_proposal_application_idempotency_key";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_tci_proposal_medusa_sync_status";`)

    this.addSql(`alter table if exists "trading_card_inventory_proposal" drop constraint if exists "CK_tci_proposal_medusa_error_requires_failed";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal" drop constraint if exists "CK_tci_proposal_medusa_sync_status";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal" drop constraint if exists "CK_tci_proposal_applied_consistency";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal" drop constraint if exists "CK_tci_proposal_review_note_length";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal" drop constraint if exists "CK_tci_proposal_rejection_reason_scope";`)

    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      drop constraint if exists "CK_trading_card_inventory_proposal_resolved_consistency";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      add constraint "CK_trading_card_inventory_proposal_resolved_consistency"
      check (
        (resolved_by is null and resolved_at is null) or
        (resolved_by is not null and resolved_at is not null)
      );`)

    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      drop column if exists "review_note",
      drop column if exists "applied_at",
      drop column if exists "applied_transaction_id",
      drop column if exists "applied_holding_id",
      drop column if exists "application_idempotency_key",
      drop column if exists "medusa_sync_status",
      drop column if exists "medusa_inventory_item_id",
      drop column if exists "medusa_stock_location_id",
      drop column if exists "medusa_sync_attempted_at",
      drop column if exists "medusa_sync_succeeded_at",
      drop column if exists "medusa_sync_retry_count",
      drop column if exists "medusa_sync_attempt_token",
      drop column if exists "medusa_sync_last_error";`)
  }
}
