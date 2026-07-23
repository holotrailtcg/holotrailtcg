import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Stage 1 (import identity & review corrections), manual local correction:
 * adds optional `illustrator` canonical-card metadata plus an
 * `illustrator_confirmed` flag so a manually-confirmed value is never
 * silently overwritten by a later, unapproved provider value (see
 * `TradingCardsModuleService#updateTradingCardIdentity`). Illustrator is
 * deliberately not part of any grouping/identity key — purely additive.
 */
export class Migration20260723120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "trading_card" add column if not exists "illustrator" text null;`)
    this.addSql(`alter table if exists "trading_card" add column if not exists "illustrator_confirmed" boolean not null default false;`)
    this.addSql(`alter table if exists "trading_card" drop constraint if exists "CK_trading_card_illustrator_length";`)
    this.addSql(`alter table if exists "trading_card" add constraint "CK_trading_card_illustrator_length" check (length(illustrator) <= 255);`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "trading_card" drop constraint if exists "CK_trading_card_illustrator_length";`)
    this.addSql(`alter table if exists "trading_card" drop column if exists "illustrator_confirmed";`)
    this.addSql(`alter table if exists "trading_card" drop column if exists "illustrator";`)
  }
}
