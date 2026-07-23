import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Codex remediation: `SPECIAL_TREATMENT.TINSEL_HOLO` was added to the
 * TypeScript enum (types.ts) after the `trading_card_variant.special_treatment`
 * check constraint was generated, so the database still rejects it even
 * though the model, UI and SKU generation all already accept it.
 */
export class Migration20260723140000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_variant" drop constraint if exists "trading_card_variant_special_treatment_check";`);
    this.addSql(`alter table if exists "trading_card_variant" add constraint "trading_card_variant_special_treatment_check" check ("special_treatment" in ('NONE', 'ENERGY_REVERSE', 'POKE_BALL_REVERSE', 'MASTER_BALL_REVERSE', 'LOVE_BALL_REVERSE', 'QUICK_BALL_REVERSE', 'FRIEND_BALL_REVERSE', 'DUSK_BALL_REVERSE', 'ROCKET_REVERSE', 'POKE_BALL', 'MASTER_BALL', 'STARLIGHT_HOLO', 'COSMOS_HOLO', 'TINSEL_HOLO', 'GALAXY_HOLO', 'CRACKED_ICE', 'STAMPED', 'PRERELEASE_STAMPED', 'PROMOTIONAL_STAMPED', 'TEXTURED', 'ETCHED', 'OTHER'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_variant" drop constraint if exists "trading_card_variant_special_treatment_check";`);
    this.addSql(`alter table if exists "trading_card_variant" add constraint "trading_card_variant_special_treatment_check" check ("special_treatment" in ('NONE', 'ENERGY_REVERSE', 'POKE_BALL_REVERSE', 'MASTER_BALL_REVERSE', 'LOVE_BALL_REVERSE', 'QUICK_BALL_REVERSE', 'FRIEND_BALL_REVERSE', 'DUSK_BALL_REVERSE', 'ROCKET_REVERSE', 'POKE_BALL', 'MASTER_BALL', 'STARLIGHT_HOLO', 'COSMOS_HOLO', 'GALAXY_HOLO', 'CRACKED_ICE', 'STAMPED', 'PRERELEASE_STAMPED', 'PROMOTIONAL_STAMPED', 'TEXTURED', 'ETCHED', 'OTHER'));`);
  }

}
