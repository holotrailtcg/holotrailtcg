import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/** Bounds diagnostic breadcrumbs without rewriting the generated Stage 3 migration. */
export class Migration20260714120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`do $$
begin
  if exists (
    select 1
    from pg_class as table_relation
    join pg_namespace as table_schema
      on table_schema.oid = table_relation.relnamespace
    where table_schema.nspname = 'public'
      and table_relation.relname = 'trading_card_external_reference'
      and not exists (
        select 1
        from pg_constraint as existing_constraint
        where existing_constraint.conrelid = table_relation.oid
          and existing_constraint.conname = 'CK_trading_card_external_reference_note_length'
      )
  ) then
    alter table if exists "public"."trading_card_external_reference"
      add constraint "CK_trading_card_external_reference_note_length"
      check (length(raw_payload_note) <= 500);
  end if;
end $$;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "public"."trading_card_external_reference" drop constraint if exists "CK_trading_card_external_reference_note_length";`)
  }
}
