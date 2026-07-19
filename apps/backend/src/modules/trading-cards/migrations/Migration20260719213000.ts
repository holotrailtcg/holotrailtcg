import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Persists the verified TCGdex parent series alongside each provider-set
 * mapping, so import review can display Series + Set without making live
 * provider requests whenever a table page is opened.
 */
export class Migration20260719213000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "trading_card_provider_set_mapping" add column if not exists "tcgdex_series_id" text null;`)
    this.addSql(`alter table "trading_card_provider_set_mapping" add column if not exists "tcgdex_series_name" text null;`)

    this.addSql(`update "trading_card_provider_set_mapping" set "tcgdex_series_id" = 'me', "tcgdex_series_name" = 'Mega Evolution' where "language" = 'EN' and "tcgdex_set_id" in ('me01', 'me02', 'me02.5', 'me03', 'me04');`)
    this.addSql(`update "trading_card_provider_set_mapping" set "tcgdex_series_id" = 'swsh', "tcgdex_series_name" = 'Sword & Shield' where "language" = 'EN' and "tcgdex_set_id" in ('swsh2', 'swsh3', 'swsh4', 'swsh4.5', 'swsh6', 'swsh10', 'swsh12.5');`)
    this.addSql(`update "trading_card_provider_set_mapping" set "tcgdex_series_id" = 'M', "tcgdex_series_name" = 'ポケモンカードゲーム MEGA' where "language" = 'JA' and "tcgdex_set_id" in ('M2a', 'm1s', 'm2', 'm2a', 'm3', 'm4');`)
    this.addSql(`update "trading_card_provider_set_mapping" set "tcgdex_series_id" = 'S', "tcgdex_series_name" = '剣と盾' where "language" = 'JA' and "tcgdex_set_id" in ('s8b', 's11a', 's12a');`)
    this.addSql(`update "trading_card_provider_set_mapping" set "tcgdex_series_id" = 'SM', "tcgdex_series_name" = 'サン＆ムーン' where "language" = 'JA' and "tcgdex_set_id" = 'sm8a';`)
    this.addSql(`update "trading_card_provider_set_mapping" set "tcgdex_series_id" = 'SV', "tcgdex_series_name" = 'ポケモンカードゲーム スカーレット&バイオレット' where "language" = 'JA' and "tcgdex_set_id" in ('sv1a', 'sv1v', 'sv2a', 'sv2d', 'sv2p', 'sv3', 'sv3a', 'sv4a', 'sv4k', 'sv5a', 'sv5k', 'sv5m', 'sv6', 'sv7', 'sv8', 'sv8a', 'sv9', 'sv9a');`)

    this.addSql(`alter table "trading_card_provider_set_mapping" drop constraint if exists "CK_provider_set_mapping_series_pair";`)
    this.addSql(`alter table "trading_card_provider_set_mapping" add constraint "CK_provider_set_mapping_series_pair" check (("tcgdex_series_id" is null and "tcgdex_series_name" is null) or ("tcgdex_series_id" is not null and "tcgdex_series_name" is not null));`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "trading_card_provider_set_mapping" drop constraint if exists "CK_provider_set_mapping_series_pair";`)
    this.addSql(`alter table "trading_card_provider_set_mapping" drop column if exists "tcgdex_series_name";`)
    this.addSql(`alter table "trading_card_provider_set_mapping" drop column if exists "tcgdex_series_id";`)
  }
}
