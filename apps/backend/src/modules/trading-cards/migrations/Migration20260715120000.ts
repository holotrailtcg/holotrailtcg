import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Stage 4B.1: additive `trading_card_image` domain table plus the matching
 * audit entity-type/action check widening. Purely additive — no existing
 * Stage 3/4A table, column, index, or row is touched.
 */
export class Migration20260715120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "trading_card_image" (
      "id" text not null,
      "trading_card_variant_id" text not null,
      "status" text check ("status" in ('PENDING', 'READY', 'DUPLICATE', 'REJECTED', 'EXPIRED', 'ARCHIVED')) not null default 'PENDING',
      "staging_object_key" text null,
      "final_object_key" text null,
      "original_filename" text not null,
      "declared_mime_type" text not null,
      "declared_byte_size" integer not null,
      "confirmed_mime_type" text null,
      "confirmed_byte_size" integer null,
      "width" integer null,
      "height" integer null,
      "sha256_hash" text null,
      "sort_order" integer not null,
      "focal_x" real not null default 0.5,
      "focal_y" real not null default 0.5,
      "uploaded_by" text not null,
      "upload_expires_at" timestamptz null,
      "archived_at" timestamptz null,
      "archived_by" text null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      "deleted_at" timestamptz null,
      constraint "trading_card_image_pkey" primary key ("id"),
      constraint "CK_trading_card_image_declared_size_positive" check (declared_byte_size > 0),
      constraint "CK_trading_card_image_confirmed_size_positive" check (confirmed_byte_size is null or confirmed_byte_size > 0),
      constraint "CK_trading_card_image_dimensions_positive" check ((width is null or width > 0) and (height is null or height > 0)),
      constraint "CK_trading_card_image_sort_order_non_negative" check (sort_order >= 0),
      constraint "CK_trading_card_image_focal_bounds" check (focal_x between 0 and 1 and focal_y between 0 and 1),
      constraint "CK_trading_card_image_sha256_format" check (sha256_hash is null or sha256_hash ~ '^[a-f0-9]{64}$'),
      constraint "CK_trading_card_image_archived_consistency" check (
        (status = 'ARCHIVED' and archived_at is not null and archived_by is not null) or
        (status <> 'ARCHIVED' and archived_at is null and archived_by is null)
      ),
      constraint "CK_trading_card_image_lifecycle_keys" check (
        case status
          when 'PENDING' then
            staging_object_key is not null and final_object_key is null and
            confirmed_mime_type is null and confirmed_byte_size is null and
            width is null and height is null and sha256_hash is null
          when 'READY' then
            staging_object_key is null and final_object_key is not null and
            confirmed_mime_type is not null and confirmed_byte_size is not null and
            width is not null and height is not null and sha256_hash is not null
          when 'ARCHIVED' then
            staging_object_key is null and final_object_key is not null and
            confirmed_mime_type is not null and confirmed_byte_size is not null and
            width is not null and height is not null and sha256_hash is not null
          else
            staging_object_key is null and final_object_key is null and
            confirmed_mime_type is null and confirmed_byte_size is null and
            width is null and height is null and sha256_hash is null
        end
      )
    );`)

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_image_deleted_at" ON "trading_card_image" ("deleted_at") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_image_variant_id" ON "trading_card_image" ("trading_card_variant_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_image_staging_key" ON "trading_card_image" ("staging_object_key") WHERE staging_object_key IS NOT NULL AND deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_image_final_key" ON "trading_card_image" ("final_object_key") WHERE final_object_key IS NOT NULL AND deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_image_sha256" ON "trading_card_image" ("sha256_hash") WHERE sha256_hash IS NOT NULL AND deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_image_ready_sort_order" ON "trading_card_image" ("trading_card_variant_id", "sort_order") WHERE status = 'READY' AND deleted_at IS NULL;`)

    this.addSql(`alter table if exists "trading_card_image" drop constraint if exists "trading_card_image_trading_card_variant_id_foreign";`)
    this.addSql(`alter table if exists "trading_card_image" add constraint "trading_card_image_trading_card_variant_id_foreign" foreign key ("trading_card_variant_id") references "trading_card_variant" ("id") on update cascade;`)

    this.addSql(`alter table "trading_card_audit_entry" drop constraint if exists "CK_trading_card_audit_entity_type";`)
    this.addSql(`alter table "trading_card_audit_entry" add constraint "CK_trading_card_audit_entity_type" check (entity_type in ('TRADING_CARD','TRADING_CARD_VARIANT','EXTERNAL_CARD_REFERENCE','ENRICHMENT_PROPOSAL','CARD_IMAGE'));`)
    this.addSql(`alter table "trading_card_audit_entry" drop constraint if exists "CK_trading_card_audit_action";`)
    this.addSql(`alter table "trading_card_audit_entry" add constraint "CK_trading_card_audit_action" check (action in ('CANONICAL_IDENTITY_CHANGED','CONDITION_CHANGED','FINISH_CHANGED','SPECIAL_TREATMENT_CHANGED','PRICE_LOCKED','PRICE_UNLOCKED','EXTERNAL_REFERENCE_ADDED','EXTERNAL_REFERENCE_CHANGED','EXTERNAL_REFERENCE_REMOVED','TCGDEX_ENRICHMENT_RECORDED','TCGDEX_ENRICHMENT_SUPERSEDED','TCGDEX_ENRICHMENT_APPROVED','TCGDEX_ENRICHMENT_REJECTED','TCGDEX_ENRICHMENT_APPLIED','TCGDEX_MANUAL_REFERENCE_RECORDED','IMAGE_UPLOAD_REQUESTED','IMAGE_UPLOAD_CONFIRMED','IMAGE_UPLOAD_REJECTED','IMAGE_UPLOAD_EXPIRED','IMAGE_DUPLICATE_DETECTED','IMAGE_REORDERED','IMAGE_FOCAL_CHANGED','IMAGE_ARCHIVED','IMAGE_RESTORED'));`)
  }

  override async down(): Promise<void> {
    this.addSql(`delete from "trading_card_audit_entry" where entity_type = 'CARD_IMAGE' or action in ('IMAGE_UPLOAD_REQUESTED','IMAGE_UPLOAD_CONFIRMED','IMAGE_UPLOAD_REJECTED','IMAGE_UPLOAD_EXPIRED','IMAGE_DUPLICATE_DETECTED','IMAGE_REORDERED','IMAGE_FOCAL_CHANGED','IMAGE_ARCHIVED','IMAGE_RESTORED');`)
    this.addSql(`alter table "trading_card_audit_entry" drop constraint if exists "CK_trading_card_audit_action";`)
    this.addSql(`alter table "trading_card_audit_entry" add constraint "CK_trading_card_audit_action" check (action in ('CANONICAL_IDENTITY_CHANGED','CONDITION_CHANGED','FINISH_CHANGED','SPECIAL_TREATMENT_CHANGED','PRICE_LOCKED','PRICE_UNLOCKED','EXTERNAL_REFERENCE_ADDED','EXTERNAL_REFERENCE_CHANGED','EXTERNAL_REFERENCE_REMOVED','TCGDEX_ENRICHMENT_RECORDED','TCGDEX_ENRICHMENT_SUPERSEDED','TCGDEX_ENRICHMENT_APPROVED','TCGDEX_ENRICHMENT_REJECTED','TCGDEX_ENRICHMENT_APPLIED','TCGDEX_MANUAL_REFERENCE_RECORDED'));`)
    this.addSql(`alter table "trading_card_audit_entry" drop constraint if exists "CK_trading_card_audit_entity_type";`)
    this.addSql(`alter table "trading_card_audit_entry" add constraint "CK_trading_card_audit_entity_type" check (entity_type in ('TRADING_CARD','TRADING_CARD_VARIANT','EXTERNAL_CARD_REFERENCE','ENRICHMENT_PROPOSAL'));`)

    this.addSql(`drop table if exists "trading_card_image" cascade;`)
  }
}
