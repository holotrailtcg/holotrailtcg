import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Stage 5B.1: Pulse CSV import columns/tables. Additive only.
 *
 * `trading_card_inventory_snapshot_entry` gains write-once parse-time
 * columns only (row_number, outcome, and bounded parsed-candidate columns) —
 * the entry's existing immutability guarantee from Stage 5A.2 is preserved,
 * nothing here is ever updated after insert.
 *
 * Matching is a separate, retryable concern and lives in the new mutable
 * `trading_card_inventory_snapshot_entry_match` table (one row per entry).
 *
 * Diagnostics are append-only and live in the new
 * `trading_card_inventory_snapshot_entry_diagnostic` table.
 */
export class Migration20260716180000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry"
      add column if not exists "row_number" integer null,
      add column if not exists "outcome" text null,
      add column if not exists "condition_source" text null,
      add column if not exists "finish_candidate" text null,
      add column if not exists "special_treatment_candidate" text null,
      add column if not exists "rarity_candidate" text null,
      add column if not exists "rarity_raw" text null,
      add column if not exists "language_conflict" boolean not null default false,
      add column if not exists "raw_fields" jsonb null;`)

    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry" drop constraint if exists "CK_tci_snapshot_entry_outcome";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry" add constraint "CK_tci_snapshot_entry_outcome"
      check (outcome is null or outcome in ('VALID', 'VALID_WITH_WARNINGS', 'UNRESOLVED_VARIANT', 'REVIEW_REQUIRED', 'INVALID', 'SKIPPED'));`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry" drop constraint if exists "CK_tci_snapshot_entry_condition_source";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry" add constraint "CK_tci_snapshot_entry_condition_source"
      check (condition_source is null or condition_source in ('EXPLICIT', 'DEFAULTED'));`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry" drop constraint if exists "CK_tci_snapshot_entry_candidate_lengths";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry" add constraint "CK_tci_snapshot_entry_candidate_lengths"
      check (
        length(finish_candidate) <= 64 and length(special_treatment_candidate) <= 64 and
        length(rarity_candidate) <= 64 and length(rarity_raw) <= 128
      );`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry" drop constraint if exists "CK_tci_snapshot_entry_raw_fields_bounded";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry" add constraint "CK_tci_snapshot_entry_raw_fields_bounded"
      check (raw_fields is null or octet_length(raw_fields::text) <= 4000);`)

    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tci_snapshot_entry_row_number" ON "trading_card_inventory_snapshot_entry"
      ("inventory_snapshot_id", "row_number") WHERE row_number IS NOT NULL AND deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tci_snapshot_entry_outcome" ON "trading_card_inventory_snapshot_entry"
      ("inventory_snapshot_id", "outcome") WHERE deleted_at IS NULL;`)

    this.addSql(`create table if not exists "trading_card_inventory_snapshot_entry_match" (
      "id" text not null,
      "snapshot_entry_id" text not null,
      "inventory_snapshot_id" text not null,
      "matching_status" text check ("matching_status" in ('UNMATCHED', 'MATCHED', 'AMBIGUOUS', 'REVIEW_REQUIRED')) not null default 'UNMATCHED',
      "trading_card_variant_id" text null,
      "matched_via" text check ("matched_via" in ('TRUSTED_REFERENCE', 'UNIQUE_ATTRIBUTE_MATCH', 'NONE')) not null default 'NONE',
      "matched_at" timestamptz null,
      "retry_count" integer not null default 0,
      "last_retried_at" timestamptz null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "trading_card_inventory_snapshot_entry_match_pkey" primary key ("id"),
      constraint "CK_tci_snapshot_entry_match_retry_count_non_negative" check (retry_count >= 0),
      constraint "CK_tci_snapshot_entry_match_variant_consistency" check (
        (matching_status = 'MATCHED' and trading_card_variant_id is not null) or
        (matching_status <> 'MATCHED' and trading_card_variant_id is null) or
        matching_status is null
      )
    );`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tci_snapshot_entry_match_deleted_at" ON "trading_card_inventory_snapshot_entry_match" ("deleted_at") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tci_snapshot_entry_match_entry" ON "trading_card_inventory_snapshot_entry_match" ("snapshot_entry_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tci_snapshot_entry_match_snapshot_status" ON "trading_card_inventory_snapshot_entry_match" ("inventory_snapshot_id", "matching_status") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tci_snapshot_entry_match_variant" ON "trading_card_inventory_snapshot_entry_match" ("trading_card_variant_id") WHERE deleted_at IS NULL;`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_match" drop constraint if exists "tci_snapshot_entry_match_entry_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_match" add constraint "tci_snapshot_entry_match_entry_id_foreign"
      foreign key ("snapshot_entry_id") references "trading_card_inventory_snapshot_entry" ("id") on update cascade;`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_match" drop constraint if exists "tci_snapshot_entry_match_snapshot_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_match" add constraint "tci_snapshot_entry_match_snapshot_id_foreign"
      foreign key ("inventory_snapshot_id") references "trading_card_inventory_snapshot" ("id") on update cascade;`)

    this.addSql(`create table if not exists "trading_card_inventory_snapshot_entry_diagnostic" (
      "id" text not null,
      "snapshot_entry_id" text not null,
      "inventory_snapshot_id" text not null,
      "row_number" integer not null,
      "phase" text check ("phase" in ('PARSE', 'MATCHING')) not null,
      "code" text not null,
      "severity" text check ("severity" in ('INFO', 'WARNING', 'ERROR')) not null,
      "field_ref" text null,
      "message" text not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "trading_card_inventory_snapshot_entry_diagnostic_pkey" primary key ("id"),
      constraint "CK_tci_snapshot_entry_diagnostic_code_length" check (length(code) between 1 and 64),
      constraint "CK_tci_snapshot_entry_diagnostic_field_ref_length" check (length(field_ref) <= 64),
      constraint "CK_tci_snapshot_entry_diagnostic_message_length" check (length(message) between 1 and 500)
    );`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tci_snapshot_entry_diagnostic_deleted_at" ON "trading_card_inventory_snapshot_entry_diagnostic" ("deleted_at") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tci_snapshot_entry_diagnostic_entry" ON "trading_card_inventory_snapshot_entry_diagnostic" ("snapshot_entry_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_tci_snapshot_entry_diagnostic_snapshot_severity" ON "trading_card_inventory_snapshot_entry_diagnostic" ("inventory_snapshot_id", "severity") WHERE deleted_at IS NULL;`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_diagnostic" drop constraint if exists "tci_snapshot_entry_diagnostic_entry_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_diagnostic" add constraint "tci_snapshot_entry_diagnostic_entry_id_foreign"
      foreign key ("snapshot_entry_id") references "trading_card_inventory_snapshot_entry" ("id") on update cascade;`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_diagnostic" drop constraint if exists "tci_snapshot_entry_diagnostic_snapshot_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_diagnostic" add constraint "tci_snapshot_entry_diagnostic_snapshot_id_foreign"
      foreign key ("inventory_snapshot_id") references "trading_card_inventory_snapshot" ("id") on update cascade;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_diagnostic" drop constraint if exists "tci_snapshot_entry_diagnostic_entry_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_diagnostic" drop constraint if exists "tci_snapshot_entry_diagnostic_snapshot_id_foreign";`)
    this.addSql(`drop table if exists "trading_card_inventory_snapshot_entry_diagnostic" cascade;`)

    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_match" drop constraint if exists "tci_snapshot_entry_match_entry_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry_match" drop constraint if exists "tci_snapshot_entry_match_snapshot_id_foreign";`)
    this.addSql(`drop table if exists "trading_card_inventory_snapshot_entry_match" cascade;`)

    this.addSql(`DROP INDEX IF EXISTS "IDX_tci_snapshot_entry_row_number";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_tci_snapshot_entry_outcome";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry" drop constraint if exists "CK_tci_snapshot_entry_outcome";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry" drop constraint if exists "CK_tci_snapshot_entry_condition_source";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry" drop constraint if exists "CK_tci_snapshot_entry_candidate_lengths";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry" drop constraint if exists "CK_tci_snapshot_entry_raw_fields_bounded";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry"
      drop column if exists "row_number", drop column if exists "outcome", drop column if exists "condition_source",
      drop column if exists "finish_candidate", drop column if exists "special_treatment_candidate",
      drop column if exists "rarity_candidate", drop column if exists "rarity_raw",
      drop column if exists "language_conflict", drop column if exists "raw_fields";`)
  }
}
