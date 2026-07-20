import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260720120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "ebay_integration_store_category_import_preview" ("id" text not null, "environment" text not null check ("environment" in ('SANDBOX','PRODUCTION')), "ebay_account_id" text not null, "actor_id" text not null, "csv_sha256" text not null, "catalogue_fingerprint" text not null, "safe_summary" jsonb not null, "expires_at" timestamptz not null, "status" text not null default 'ACTIVE' check ("status" in ('ACTIVE','CONSUMED')), "consumed_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ebay_integration_store_category_import_preview_pkey" primary key ("id"), constraint "CK_ebay_store_category_preview_csv_sha256" check (csv_sha256 ~ '^[a-f0-9]{64}$'), constraint "CK_ebay_store_category_preview_fingerprint" check (catalogue_fingerprint ~ '^[a-f0-9]{64}$'), constraint "CK_ebay_store_category_preview_consumption" check ((status='ACTIVE' and consumed_at is null) or (status='CONSUMED' and consumed_at is not null)));`)
    this.addSql(`create index "IDX_ebay_store_category_preview_actor" on "ebay_integration_store_category_import_preview" ("actor_id", "expires_at");`)
    this.addSql(`create index "IDX_ebay_store_category_preview_scope" on "ebay_integration_store_category_import_preview" ("environment", "ebay_account_id", "expires_at");`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ebay_integration_store_category_import_preview" cascade;`)
  }
}
