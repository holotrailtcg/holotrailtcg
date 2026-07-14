import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260714062433 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "trading_card_audit_entry" ("id" text not null, "actor" text not null, "entity_type" text check ("entity_type" in ('TRADING_CARD', 'TRADING_CARD_VARIANT', 'EXTERNAL_CARD_REFERENCE')) not null, "entity_id" text not null, "action" text check ("action" in ('CANONICAL_IDENTITY_CHANGED', 'CONDITION_CHANGED', 'FINISH_CHANGED', 'SPECIAL_TREATMENT_CHANGED', 'PRICE_LOCKED', 'PRICE_UNLOCKED', 'EXTERNAL_REFERENCE_ADDED', 'EXTERNAL_REFERENCE_CHANGED', 'EXTERNAL_REFERENCE_REMOVED')) not null, "old_value" jsonb null, "new_value" jsonb null, "reason" text null, "source" text check ("source" in ('MANUAL', 'TCGDEX', 'PULSE', 'OTHER')) not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "trading_card_audit_entry_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_audit_entry_deleted_at" ON "trading_card_audit_entry" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_audit_entity" ON "trading_card_audit_entry" ("entity_type", "entity_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "trading_card_set" ("id" text not null, "game" text check ("game" in ('POKEMON')) not null default 'POKEMON', "language" text check ("language" in ('EN', 'JA', 'ZH')) not null, "display_name" text not null, "provider_set_code" text not null, "holo_trail_set_key" text null, "release_date" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "trading_card_set_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_set_deleted_at" ON "trading_card_set" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_set_identity" ON "trading_card_set" ("game", "language", "provider_set_code") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "trading_card_rarity_mapping" ("id" text not null, "provider" text check ("provider" in ('TCGDEX', 'PULSE', 'EBAY', 'OTHER')) not null, "language" text check ("language" in ('EN', 'JA', 'ZH')) null, "raw_value" text not null, "comparison_value" text not null, "rarity" text check ("rarity" in ('ACE_SPEC', 'BLACK_WHITE_RARE', 'COMMON', 'DOUBLE_RARE', 'HYPER_RARE', 'ILLUSTRATION_RARE', 'MEGA_ATTACK_RARE', 'MEGA_HYPER_RARE', 'NO_RARITY', 'PROMO', 'SHINY_ULTRA_RARE', 'ULTRA_RARE_SINGLE', 'ULTRA_RARE', 'UNCOMMON')) not null, "icon_key" text check ("icon_key" in ('ace-spec', 'black-white-rare', 'common', 'double-rare', 'hyper-rare', 'illustration-rare', 'mega-attack-rare', 'mega-hyper-rare', 'no-rarity', 'promo', 'shiny-ultra-rare', 'ultra-rare-single', 'ultra-rare', 'uncommon')) not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "trading_card_rarity_mapping_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_rarity_mapping_deleted_at" ON "trading_card_rarity_mapping" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_rarity_mapping_global" ON "trading_card_rarity_mapping" ("provider", "comparison_value") WHERE language IS NULL AND deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_rarity_mapping_language" ON "trading_card_rarity_mapping" ("provider", "language", "comparison_value") WHERE language IS NOT NULL AND deleted_at IS NULL;`);

    this.addSql(`create table if not exists "trading_card" ("id" text not null, "card_set_id" text not null, "name" text not null, "search_name" text not null, "slug" text null, "card_number" text not null, "card_number_normalised" text not null, "rarity_raw" text null, "rarity_comparison" text null, "rarity" text check ("rarity" in ('ACE_SPEC', 'BLACK_WHITE_RARE', 'COMMON', 'DOUBLE_RARE', 'HYPER_RARE', 'ILLUSTRATION_RARE', 'MEGA_ATTACK_RARE', 'MEGA_HYPER_RARE', 'NO_RARITY', 'PROMO', 'SHINY_ULTRA_RARE', 'ULTRA_RARE_SINGLE', 'ULTRA_RARE', 'UNCOMMON')) null, "rarity_icon_key" text check ("rarity_icon_key" in ('ace-spec', 'black-white-rare', 'common', 'double-rare', 'hyper-rare', 'illustration-rare', 'mega-attack-rare', 'mega-hyper-rare', 'no-rarity', 'promo', 'shiny-ultra-rare', 'ultra-rare-single', 'ultra-rare', 'uncommon')) null, "origin" text check ("origin" in ('MANUAL', 'TCGDEX', 'PULSE', 'OTHER')) not null default 'MANUAL', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "trading_card_pkey" primary key ("id"), constraint CK_trading_card_rarity_mapping_pair check ((rarity is null and rarity_icon_key is null) or (rarity is not null and rarity_icon_key is not null)));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_card_set_id" ON "trading_card" ("card_set_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_deleted_at" ON "trading_card" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_identity" ON "trading_card" ("card_set_id", "card_number_normalised") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "trading_card_variant" ("id" text not null, "trading_card_id" text not null, "condition" text check ("condition" in ('NEAR_MINT', 'LIGHTLY_PLAYED', 'MODERATELY_PLAYED', 'HEAVILY_PLAYED', 'DAMAGED')) not null, "condition_source" text check ("condition_source" in ('EXPLICIT', 'DEFAULTED')) not null, "finish" text check ("finish" in ('NORMAL', 'HOLO', 'REVERSE_HOLO', 'OTHER')) not null, "finish_confirmed" boolean not null default false, "special_treatment" text check ("special_treatment" in ('NONE', 'ENERGY_REVERSE', 'POKE_BALL_REVERSE', 'MASTER_BALL_REVERSE', 'LOVE_BALL_REVERSE', 'QUICK_BALL_REVERSE', 'FRIEND_BALL_REVERSE', 'DUSK_BALL_REVERSE', 'ROCKET_REVERSE', 'POKE_BALL', 'MASTER_BALL', 'STARLIGHT_HOLO', 'COSMOS_HOLO', 'GALAXY_HOLO', 'CRACKED_ICE', 'STAMPED', 'PRERELEASE_STAMPED', 'PROMOTIONAL_STAMPED', 'TEXTURED', 'ETCHED', 'OTHER')) not null default 'NONE', "special_treatment_confirmed" boolean not null default true, "sku" text not null, "origin" text check ("origin" in ('MANUAL', 'TCGDEX', 'PULSE', 'OTHER')) not null default 'MANUAL', "price_locked" boolean not null default false, "price_locked_at" timestamptz null, "price_locked_actor" text null, "price_lock_reason" text null, "is_high_value_track_individually" boolean not null default false, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "trading_card_variant_pkey" primary key ("id"), constraint CK_trading_card_variant_sku_length check (length(sku) between 1 and 128), constraint CK_trading_card_variant_sku_charset check (sku ~ '^[A-Z0-9_-]+\$'), constraint CK_trading_card_variant_price_lock_consistency check ((price_locked and price_locked_at is not null and price_locked_actor is not null) or (not price_locked and price_locked_at is null and price_locked_actor is null and price_lock_reason is null)), constraint CK_trading_card_variant_normal_finish_confirmed check (finish <> 'NORMAL' or finish_confirmed));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_variant_trading_card_id" ON "trading_card_variant" ("trading_card_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_variant_deleted_at" ON "trading_card_variant" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_variant_identity" ON "trading_card_variant" ("trading_card_id", "condition", "finish", "special_treatment") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_variant_sku" ON "trading_card_variant" ("sku") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "trading_card_external_reference" ("id" text not null, "trading_card_id" text not null, "trading_card_variant_id" text null, "provider" text check ("provider" in ('TCGDEX', 'PULSE', 'EBAY', 'OTHER')) not null, "provider_identifier" text not null, "language" text check ("language" in ('EN', 'JA', 'ZH')) null, "region" text null, "raw_payload_note" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "trading_card_external_reference_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_external_reference_trading_card_id" ON "trading_card_external_reference" ("trading_card_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_external_reference_trading_card_variant_id" ON "trading_card_external_reference" ("trading_card_variant_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_external_reference_deleted_at" ON "trading_card_external_reference" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_external_reference_provider_identifier" ON "trading_card_external_reference" ("provider", "provider_identifier") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "trading_card" add constraint "trading_card_card_set_id_foreign" foreign key ("card_set_id") references "trading_card_set" ("id") on update cascade;`);

    this.addSql(`alter table if exists "trading_card_variant" add constraint "trading_card_variant_trading_card_id_foreign" foreign key ("trading_card_id") references "trading_card" ("id") on update cascade;`);

    this.addSql(`alter table if exists "trading_card_external_reference" add constraint "trading_card_external_reference_trading_card_id_foreign" foreign key ("trading_card_id") references "trading_card" ("id") on update cascade;`);
    this.addSql(`alter table if exists "trading_card_external_reference" add constraint "trading_card_external_reference_trading_card_variant_id_foreign" foreign key ("trading_card_variant_id") references "trading_card_variant" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "trading_card" drop constraint if exists "trading_card_card_set_id_foreign";`);

    this.addSql(`alter table if exists "trading_card_variant" drop constraint if exists "trading_card_variant_trading_card_id_foreign";`);

    this.addSql(`alter table if exists "trading_card_external_reference" drop constraint if exists "trading_card_external_reference_trading_card_id_foreign";`);

    this.addSql(`alter table if exists "trading_card_external_reference" drop constraint if exists "trading_card_external_reference_trading_card_variant_id_foreign";`);

    this.addSql(`drop table if exists "trading_card_audit_entry" cascade;`);

    this.addSql(`drop table if exists "trading_card_set" cascade;`);

    this.addSql(`drop table if exists "trading_card_rarity_mapping" cascade;`);

    this.addSql(`drop table if exists "trading_card" cascade;`);

    this.addSql(`drop table if exists "trading_card_variant" cascade;`);

    this.addSql(`drop table if exists "trading_card_external_reference" cascade;`);
  }

}
