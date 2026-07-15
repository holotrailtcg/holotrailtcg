import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260714150000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "trading_card_external_reference" alter column "trading_card_id" drop not null;`)
    this.addSql(`alter table "trading_card_external_reference" add column if not exists "card_set_id" text null;`)
    this.addSql(`alter table "trading_card_external_reference" add column if not exists "provenance" text not null default 'AUTOMATIC';`)
    this.addSql(`alter table "trading_card_external_reference" drop constraint if exists "CK_tc_reference_owner";`)
    this.addSql(`alter table "trading_card_external_reference" drop constraint if exists "CK_tc_reference_provenance";`)
    this.addSql(`alter table "trading_card_external_reference" drop constraint if exists "trading_card_external_reference_card_set_id_foreign";`)
    this.addSql(`delete from "trading_card_external_reference" where trading_card_id is null and card_set_id is null;`)
    this.addSql(`alter table "trading_card_external_reference" add constraint "CK_tc_reference_owner" check ((trading_card_id is not null) <> (card_set_id is not null));`)
    this.addSql(`alter table "trading_card_external_reference" add constraint "CK_tc_reference_provenance" check (provenance in ('AUTOMATIC', 'TRUSTED_MANUAL'));`)
    this.addSql(`alter table "trading_card_external_reference" add constraint "trading_card_external_reference_card_set_id_foreign" foreign key (card_set_id) references trading_card_set (id) on update cascade;`)
    this.addSql(`alter table "trading_card_external_reference" drop constraint if exists "CK_tc_reference_variant_owner";`)
    this.addSql(`alter table "trading_card_external_reference" add constraint "CK_tc_reference_variant_owner" check (card_set_id is null or trading_card_variant_id is null);`)
    this.addSql(`create unique index if not exists "IDX_tc_variant_card_pair" on "trading_card_variant" (id, trading_card_id);`)
    this.addSql(`alter table "trading_card_external_reference" drop constraint if exists "CK_tc_reference_variant_card_fk";`)
    this.addSql(`alter table "trading_card_external_reference" add constraint "CK_tc_reference_variant_card_fk" foreign key (trading_card_variant_id, trading_card_id) references trading_card_variant (id, trading_card_id);`)
    this.addSql(`create index if not exists "IDX_tc_reference_card_set_id" on "trading_card_external_reference" (card_set_id) where deleted_at is null;`)

    this.addSql(`alter table "trading_card_audit_entry" drop constraint if exists "trading_card_audit_entry_entity_type_check";`)
    this.addSql(`alter table "trading_card_audit_entry" drop constraint if exists "CK_trading_card_audit_entity_type";`)
    this.addSql(`alter table "trading_card_audit_entry" add constraint "CK_trading_card_audit_entity_type" check (entity_type in ('TRADING_CARD','TRADING_CARD_VARIANT','EXTERNAL_CARD_REFERENCE','ENRICHMENT_PROPOSAL'));`)
    this.addSql(`alter table "trading_card_audit_entry" drop constraint if exists "trading_card_audit_entry_action_check";`)
    this.addSql(`alter table "trading_card_audit_entry" drop constraint if exists "CK_trading_card_audit_action";`)
    this.addSql(`alter table "trading_card_audit_entry" add constraint "CK_trading_card_audit_action" check (action in ('CANONICAL_IDENTITY_CHANGED','CONDITION_CHANGED','FINISH_CHANGED','SPECIAL_TREATMENT_CHANGED','PRICE_LOCKED','PRICE_UNLOCKED','EXTERNAL_REFERENCE_ADDED','EXTERNAL_REFERENCE_CHANGED','EXTERNAL_REFERENCE_REMOVED','TCGDEX_ENRICHMENT_RECORDED','TCGDEX_ENRICHMENT_SUPERSEDED','TCGDEX_ENRICHMENT_APPROVED','TCGDEX_ENRICHMENT_REJECTED','TCGDEX_ENRICHMENT_APPLIED','TCGDEX_MANUAL_REFERENCE_RECORDED'));`)

    this.addSql(`create table if not exists "trading_card_tcgdex_enrichment_proposal" ("id" text not null, "trading_card_id" text not null, "provider" text not null check (provider = 'TCGDEX'), "provider_card_id" text not null, "provider_set_id" text not null, "match_source" text not null check (match_source in ('AUTOMATIC','MANUAL')), "snapshot" jsonb not null, "snapshot_fingerprint" text not null, "review_status" text not null default 'PENDING' check (review_status in ('PENDING','APPROVED','REJECTED','APPLIED','SUPERSEDED')), "reviewed_at" timestamptz null, "reviewer_id" text null, "applied_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "trading_card_tcgdex_enrichment_proposal_pkey" primary key (id), constraint "trading_card_tcgdex_enrichment_proposal_card_fk" foreign key (trading_card_id) references trading_card(id));`)
    this.addSql(`create index if not exists "IDX_tcgdex_proposal_card_provider" on trading_card_tcgdex_enrichment_proposal (trading_card_id, provider) where deleted_at is null;`)
    this.addSql(`create unique index if not exists "IDX_tcgdex_proposal_snapshot" on trading_card_tcgdex_enrichment_proposal (trading_card_id, provider, snapshot_fingerprint) where deleted_at is null;`)
    this.addSql(`create unique index if not exists "IDX_tcgdex_proposal_one_actionable" on trading_card_tcgdex_enrichment_proposal (trading_card_id, provider) where review_status in ('PENDING', 'APPROVED') and deleted_at is null;`)

    this.addSql(`create table if not exists "trading_card_tcgdex_enrichment_attempt" ("id" text not null, "trading_card_id" text not null, "provider" text not null check (provider = 'TCGDEX'), "match_source" text not null check (match_source in ('AUTOMATIC','MANUAL')), "match_outcome" text not null check (match_outcome in ('MATCHED','NO_MATCH','UNRESOLVED_SET','IDENTITY_MISMATCH','INVALID_LOCAL_IDENTITY','PROVIDER_ERROR')), "provider_card_id" text null, "provider_set_id" text null, "safe_provider_error_code" text null, "diagnostic_fingerprint" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "trading_card_tcgdex_enrichment_attempt_pkey" primary key (id), constraint "trading_card_tcgdex_enrichment_attempt_card_fk" foreign key (trading_card_id) references trading_card(id), constraint "CK_tcgdex_attempt_error_code" check ((match_outcome = 'PROVIDER_ERROR' and safe_provider_error_code is not null) or (match_outcome <> 'PROVIDER_ERROR' and safe_provider_error_code is null)), constraint "CK_tcgdex_attempt_identity_ids" check ((match_outcome = 'IDENTITY_MISMATCH' and provider_card_id is not null and provider_set_id is not null) or (match_outcome <> 'IDENTITY_MISMATCH' and provider_card_id is null and provider_set_id is null)), constraint "CK_tcgdex_attempt_identifier_lengths" check (length(provider_card_id) <= 128 and length(provider_set_id) <= 128 and length(safe_provider_error_code) <= 128));`)
    this.addSql(`create index if not exists "IDX_tcgdex_attempt_card_provider" on trading_card_tcgdex_enrichment_attempt (trading_card_id, provider) where deleted_at is null;`)
    this.addSql(`create unique index if not exists "IDX_tcgdex_attempt_diagnostic" on trading_card_tcgdex_enrichment_attempt (trading_card_id, provider, diagnostic_fingerprint) where deleted_at is null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "trading_card_tcgdex_enrichment_attempt" cascade;`)
    this.addSql(`drop table if exists "trading_card_tcgdex_enrichment_proposal" cascade;`)
    this.addSql(`alter table "trading_card_external_reference" drop constraint if exists "trading_card_external_reference_card_set_id_foreign";`)
    this.addSql(`alter table "trading_card_external_reference" drop constraint if exists "CK_tc_reference_owner";`)
    this.addSql(`alter table "trading_card_external_reference" drop constraint if exists "CK_tc_reference_provenance";`)
    this.addSql(`alter table "trading_card_external_reference" drop constraint if exists "CK_tc_reference_variant_owner";`)
    this.addSql(`alter table "trading_card_external_reference" drop constraint if exists "CK_tc_reference_variant_card_fk";`)
    this.addSql(`delete from "trading_card_external_reference" where card_set_id is not null;`)
    this.addSql(`drop index if exists "IDX_tc_reference_card_set_id";`)
    this.addSql(`drop index if exists "IDX_tc_variant_card_pair";`)
    this.addSql(`alter table "trading_card_external_reference" drop column if exists "card_set_id";`)
    this.addSql(`alter table "trading_card_external_reference" drop column if exists "provenance";`)
    this.addSql(`alter table "trading_card_external_reference" alter column "trading_card_id" set not null;`)
    this.addSql(`delete from "trading_card_audit_entry" where entity_type = 'ENRICHMENT_PROPOSAL' or action in ('TCGDEX_ENRICHMENT_RECORDED','TCGDEX_ENRICHMENT_SUPERSEDED','TCGDEX_ENRICHMENT_APPROVED','TCGDEX_ENRICHMENT_REJECTED','TCGDEX_ENRICHMENT_APPLIED','TCGDEX_MANUAL_REFERENCE_RECORDED');`)
    this.addSql(`alter table "trading_card_audit_entry" drop constraint if exists "CK_trading_card_audit_entity_type";`)
    this.addSql(`alter table "trading_card_audit_entry" drop constraint if exists "CK_trading_card_audit_action";`)
    this.addSql(`alter table "trading_card_audit_entry" add constraint "trading_card_audit_entry_entity_type_check" check (entity_type in ('TRADING_CARD','TRADING_CARD_VARIANT','EXTERNAL_CARD_REFERENCE'));`)
    this.addSql(`alter table "trading_card_audit_entry" add constraint "trading_card_audit_entry_action_check" check (action in ('CANONICAL_IDENTITY_CHANGED','CONDITION_CHANGED','FINISH_CHANGED','SPECIAL_TREATMENT_CHANGED','PRICE_LOCKED','PRICE_UNLOCKED','EXTERNAL_REFERENCE_ADDED','EXTERNAL_REFERENCE_CHANGED','EXTERNAL_REFERENCE_REMOVED'));`)
  }
}
