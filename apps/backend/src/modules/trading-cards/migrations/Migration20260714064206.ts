import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260714064206 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "trading_card" add constraint CK_trading_card_rarity_raw_pair check((rarity_raw is null and rarity_comparison is null) or (rarity_raw is not null and rarity_comparison is not null));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "trading_card" drop constraint if exists CK_trading_card_rarity_raw_pair;`);
  }

}
