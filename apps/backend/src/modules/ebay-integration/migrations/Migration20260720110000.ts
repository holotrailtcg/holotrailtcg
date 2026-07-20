import { Migration } from "@medusajs/framework/mikro-orm/migrations"
export class Migration20260720110000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "ebay_integration_store_category" ("id" text not null, "environment" text not null check ("environment" in ('SANDBOX','PRODUCTION')), "ebay_account_id" text not null, "external_id" text not null, "name" text not null, "parent_external_id" text null, "sibling_order" integer not null, "level" smallint not null, "path" text not null, "status" text not null check ("status" in ('ACTIVE','REMOVED')), "source" text not null check ("source" in ('MANUAL','CSV')), "removed_at" timestamptz null, "removed_by" text null, "removal_reason" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ebay_integration_store_category_pkey" primary key ("id"), constraint "CK_ebay_store_category_level" check (level between 1 and 3), constraint "CK_ebay_store_category_order" check (sibling_order >= 0), constraint "CK_ebay_store_category_self_parent" check (parent_external_id is null or parent_external_id <> external_id));`)
    this.addSql(`create unique index "IDX_ebay_store_category_identity" on "ebay_integration_store_category" ("environment","ebay_account_id","external_id") where deleted_at is null;`)
    this.addSql(`create index "IDX_ebay_store_category_tree" on "ebay_integration_store_category" ("environment","ebay_account_id","parent_external_id","sibling_order") where deleted_at is null;`)
    this.addSql(`create or replace function ebay_integration_validate_store_category_hierarchy() returns trigger language plpgsql as $$
      declare parent_row ebay_integration_store_category%rowtype; cycle_found boolean;
      begin
        if new.deleted_at is not null or new.status = 'REMOVED' then
          if exists(select 1 from ebay_integration_store_category c where c.environment = new.environment and c.ebay_account_id = new.ebay_account_id and c.parent_external_id = new.external_id and c.status = 'ACTIVE' and c.deleted_at is null) then
            raise exception 'Removed Store category cannot retain active children' using errcode = '23514', constraint = 'TRG_ebay_store_category_hierarchy';
          end if;
          return new;
        end if;
        if new.parent_external_id is null then
          if new.level <> 1 then raise exception 'Root Store category must be level 1' using errcode = '23514', constraint = 'TRG_ebay_store_category_hierarchy'; end if;
          return new;
        end if;
        select * into parent_row from ebay_integration_store_category
          where environment = new.environment and ebay_account_id = new.ebay_account_id
            and external_id = new.parent_external_id and deleted_at is null and status = 'ACTIVE' for key share;
        if not found then raise exception 'Store category parent must be active and in the same environment/account' using errcode = '23503', constraint = 'TRG_ebay_store_category_hierarchy'; end if;
        if new.level <> parent_row.level + 1 then raise exception 'Store category level must be exactly parent level plus one' using errcode = '23514', constraint = 'TRG_ebay_store_category_hierarchy'; end if;
        with recursive ancestors as (
          select id, parent_external_id, environment, ebay_account_id from ebay_integration_store_category where id = parent_row.id
          union all
          select c.id, c.parent_external_id, c.environment, c.ebay_account_id from ebay_integration_store_category c join ancestors a
            on c.environment = a.environment and c.ebay_account_id = a.ebay_account_id and c.external_id = a.parent_external_id
          where c.deleted_at is null and c.status = 'ACTIVE'
        ) select exists(select 1 from ancestors where id = new.id) into cycle_found;
        if cycle_found then raise exception 'Store category parent cycle is not allowed' using errcode = '23514', constraint = 'TRG_ebay_store_category_hierarchy'; end if;
        return new;
      end $$;`)
    this.addSql(`create constraint trigger "TRG_ebay_store_category_hierarchy" after insert or update of environment, ebay_account_id, external_id, parent_external_id, level, status, deleted_at on "ebay_integration_store_category" deferrable initially deferred for each row execute function ebay_integration_validate_store_category_hierarchy();`)
    this.addSql(`create table "ebay_integration_store_category_audit" ("id" text not null, "environment" text not null check ("environment" in ('SANDBOX','PRODUCTION')), "ebay_account_id" text not null, "actor_id" text not null, "action" text not null, "category_id" text null, "correlation_id" text not null, "details" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ebay_integration_store_category_audit_pkey" primary key ("id"));`)
    this.addSql(`create index "IDX_ebay_store_category_audit_scope" on "ebay_integration_store_category_audit" ("environment","ebay_account_id","created_at");`)
  }
  override async down(): Promise<void> { this.addSql(`drop table if exists "ebay_integration_store_category_audit" cascade;`); this.addSql(`drop trigger if exists "TRG_ebay_store_category_hierarchy" on "ebay_integration_store_category"; drop function if exists ebay_integration_validate_store_category_hierarchy(); drop table if exists "ebay_integration_store_category" cascade;`) }
}
