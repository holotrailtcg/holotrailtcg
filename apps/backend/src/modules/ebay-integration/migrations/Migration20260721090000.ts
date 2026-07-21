import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260721090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "ebay_integration_store_category" add column "medusa_category_id" text null, add column "medusa_category_synced_at" timestamptz null;`,
    )

    this.addSql(
      `create table "ebay_integration_category_assignment_rule" ("id" text not null, "environment" text not null check ("environment" in ('SANDBOX','PRODUCTION')), "ebay_account_id" text not null, "name" text not null, "enabled" boolean not null default true, "priority" int not null, "target_store_category_id" text not null, "conditions" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ebay_integration_category_assignment_rule_pkey" primary key ("id"), constraint "CK_ebay_category_rule_priority" check ("priority" >= 0), constraint "CK_ebay_category_rule_name_length" check (length("name") between 1 and 255));`,
    )
    this.addSql(
      `create index "IDX_ebay_category_rule_scope" on "ebay_integration_category_assignment_rule" ("environment", "ebay_account_id", "priority") where "deleted_at" is null;`,
    )
    this.addSql(
      `create index "IDX_ebay_category_rule_target" on "ebay_integration_category_assignment_rule" ("target_store_category_id") where "deleted_at" is null;`,
    )

    this.addSql(
      `create table "ebay_integration_category_assignment_settings" ("id" text not null, "environment" text not null check ("environment" in ('SANDBOX','PRODUCTION')), "ebay_account_id" text not null, "fallback_store_category_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ebay_integration_category_assignment_settings_pkey" primary key ("id"));`,
    )
    this.addSql(
      `create unique index "IDX_ebay_category_assignment_settings_scope" on "ebay_integration_category_assignment_settings" ("environment", "ebay_account_id") where "deleted_at" is null;`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ebay_integration_category_assignment_settings" cascade;`)
    this.addSql(`drop table if exists "ebay_integration_category_assignment_rule" cascade;`)
    this.addSql(
      `alter table "ebay_integration_store_category" drop column if exists "medusa_category_id", drop column if exists "medusa_category_synced_at";`,
    )
  }
}
