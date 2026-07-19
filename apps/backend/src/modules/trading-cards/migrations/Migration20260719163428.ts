import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds `trading_card_provider_set_mapping` — a confirmed mapping from one
 * inventory provider's own set code (e.g. Pulse's "swsh4pt5") to the real
 * TCGdex set id (e.g. "swsh4.5"). Exists independently of `trading_card_set`
 * so a mapping can be confirmed before any card in that set exists locally.
 *
 * Seeded with the mappings verified against the live TCGdex API for the
 * sets already seen in real Pulse/eBay exports across English, the "ME"
 * era, and Japanese. Chinese mappings are deliberately not seeded here —
 * see docs/decisions for the zh-cn vs zh-tw language discrepancy that must
 * be resolved first.
 *
 * The schema generator's diff against this module's models also proposed
 * re-applying `trading_card_tcgdex_enrichment_proposal`,
 * `trading_card_tcgdex_enrichment_attempt`, `trading_card_image`, and the
 * `trading_card_external_reference` `card_set_id`/`provenance` columns —
 * all of which were already applied by `Migration20260714150000` and
 * `Migration20260715120000` (confirmed via `db:migrate` reporting this
 * module up-to-date beforehand). That re-emission came from a stale
 * MikroORM snapshot comparison, not a real gap, and has been stripped from
 * this migration to keep it scoped to the actual new table.
 */
export class Migration20260719163428 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "trading_card_provider_set_mapping" ("id" text not null, "provider" text check ("provider" in ('TCGDEX', 'PULSE', 'EBAY', 'OTHER')) not null, "game" text check ("game" in ('POKEMON')) not null, "language" text check ("language" in ('EN', 'JA', 'ZH')) not null, "provider_set_code" text not null, "tcgdex_set_id" text not null, "tcgdex_set_name" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "trading_card_provider_set_mapping_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_provider_set_mapping_deleted_at" ON "trading_card_provider_set_mapping" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_provider_set_mapping_identity" ON "trading_card_provider_set_mapping" ("provider", "game", "language", "provider_set_code") WHERE deleted_at IS NULL;`);

    this.addSql(`
      insert into "trading_card_provider_set_mapping"
        ("id", "provider", "game", "language", "provider_set_code", "tcgdex_set_id", "tcgdex_set_name")
      values
        ('tcpsm_seed_en_swsh4pt5', 'PULSE', 'POKEMON', 'EN', 'swsh4pt5', 'swsh4.5', 'Shining Fates'),
        ('tcpsm_seed_en_swsh12pt5', 'PULSE', 'POKEMON', 'EN', 'swsh12pt5', 'swsh12.5', 'Crown Zenith'),
        ('tcpsm_seed_en_swsh10', 'PULSE', 'POKEMON', 'EN', 'swsh10', 'swsh10', 'Astral Radiance'),
        ('tcpsm_seed_en_swsh6', 'PULSE', 'POKEMON', 'EN', 'swsh6', 'swsh6', 'Chilling Reign'),
        ('tcpsm_seed_en_swsh3', 'PULSE', 'POKEMON', 'EN', 'swsh3', 'swsh3', 'Darkness Ablaze'),
        ('tcpsm_seed_en_swsh4', 'PULSE', 'POKEMON', 'EN', 'swsh4', 'swsh4', 'Vivid Voltage'),
        ('tcpsm_seed_en_swsh2', 'PULSE', 'POKEMON', 'EN', 'swsh2', 'swsh2', 'Rebel Clash'),
        ('tcpsm_seed_en_me04', 'PULSE', 'POKEMON', 'EN', 'me04', 'me04', 'Chaos Rising'),
        ('tcpsm_seed_en_me02', 'PULSE', 'POKEMON', 'EN', 'me02', 'me02', 'Phantasmal Flames'),
        ('tcpsm_seed_en_me2pt5', 'PULSE', 'POKEMON', 'EN', 'me2pt5', 'me02.5', 'Ascended Heroes'),
        ('tcpsm_seed_en_me3', 'PULSE', 'POKEMON', 'EN', 'me3', 'me03', 'Perfect Order'),
        ('tcpsm_seed_en_m1', 'PULSE', 'POKEMON', 'EN', 'm1', 'me01', 'Mega Evolution'),
        ('tcpsm_seed_ja_s8b', 'PULSE', 'POKEMON', 'JA', 's8b_jp', 's8b', 'VMAX Climax'),
        ('tcpsm_seed_ja_s12a', 'PULSE', 'POKEMON', 'JA', 's12a_jp', 's12a', 'VSTAR Universe'),
        ('tcpsm_seed_ja_sv8a', 'PULSE', 'POKEMON', 'JA', 'sv8a_jp', 'sv8a', 'Terastal Festival ex'),
        ('tcpsm_seed_ja_sv4a', 'PULSE', 'POKEMON', 'JA', 'sv4a_jp', 'sv4a', 'Shiny Treasure ex'),
        ('tcpsm_seed_ja_sv3a', 'PULSE', 'POKEMON', 'JA', 'sv3a_jp', 'sv3a', 'Raging Surf'),
        ('tcpsm_seed_ja_m2a', 'PULSE', 'POKEMON', 'JA', 'm2a_jp', 'm2a', 'MEGA Dream ex'),
        ('tcpsm_seed_ja_sv5k', 'PULSE', 'POKEMON', 'JA', 'sv5k_jp', 'sv5k', 'Wild Force'),
        ('tcpsm_seed_ja_m2', 'PULSE', 'POKEMON', 'JA', 'm2_jp', 'm2', 'Inferno X'),
        ('tcpsm_seed_ja_sm8a', 'PULSE', 'POKEMON', 'JA', 'sm8a_jp', 'sm8a', 'Dark Order'),
        ('tcpsm_seed_ja_sv2a', 'PULSE', 'POKEMON', 'JA', 'sv2a_jp', 'sv2a', 'Pokemon Card 151'),
        ('tcpsm_seed_ja_sv9', 'PULSE', 'POKEMON', 'JA', 'sv9_jp', 'sv9', 'Battle Partners'),
        ('tcpsm_seed_ja_sv9a', 'PULSE', 'POKEMON', 'JA', 'sv9a_jp', 'sv9a', 'Hot Air Arena'),
        ('tcpsm_seed_ja_sv6', 'PULSE', 'POKEMON', 'JA', 'sv6_jp', 'sv6', 'Mask of Change'),
        ('tcpsm_seed_ja_s11a', 'PULSE', 'POKEMON', 'JA', 's11a_jp', 's11a', 'Incandescent Arcana'),
        ('tcpsm_seed_ja_sv8', 'PULSE', 'POKEMON', 'JA', 'sv8_jp', 'sv8', 'Super Electric Breaker'),
        ('tcpsm_seed_ja_sv1v', 'PULSE', 'POKEMON', 'JA', 'sv1v_jp', 'sv1v', 'Violet ex'),
        ('tcpsm_seed_ja_sv2d', 'PULSE', 'POKEMON', 'JA', 'sv2d_jp', 'sv2d', 'Clay Burst'),
        ('tcpsm_seed_ja_sv4k', 'PULSE', 'POKEMON', 'JA', 'sv4k_jp', 'sv4k', 'Ancient Roar'),
        ('tcpsm_seed_ja_sv1a', 'PULSE', 'POKEMON', 'JA', 'sv1a_jp', 'sv1a', 'Triplet Beat'),
        ('tcpsm_seed_ja_m3', 'PULSE', 'POKEMON', 'JA', 'm3_jp', 'm3', 'Nihil Zero'),
        ('tcpsm_seed_ja_sv5m', 'PULSE', 'POKEMON', 'JA', 'sv5m_jp', 'sv5m', 'Cyber Judge'),
        ('tcpsm_seed_ja_m1s', 'PULSE', 'POKEMON', 'JA', 'm1s_jp', 'm1s', 'Mega Symphonia'),
        ('tcpsm_seed_ja_sv3', 'PULSE', 'POKEMON', 'JA', 'sv3_jp', 'sv3', 'Ruler of the Black Flame'),
        ('tcpsm_seed_ja_m4', 'PULSE', 'POKEMON', 'JA', 'm4_jp', 'm4', 'Ninja Spinner'),
        ('tcpsm_seed_ja_sv7', 'PULSE', 'POKEMON', 'JA', 'sv7_jp', 'sv7', 'Stellar Miracle'),
        ('tcpsm_seed_ja_sv2p', 'PULSE', 'POKEMON', 'JA', 'sv2p_jp', 'sv2p', 'Snow Hazard'),
        ('tcpsm_seed_ja_sv5a', 'PULSE', 'POKEMON', 'JA', 'sv5a_jp', 'sv5a', 'Crimson Haze'),
        ('tcpsm_seed_ja_base3', 'PULSE', 'POKEMON', 'JA', 'base3', 'base3', 'Fossil')
      on conflict do nothing;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "trading_card_provider_set_mapping" cascade;`);
  }

}
