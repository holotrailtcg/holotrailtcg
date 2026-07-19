import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Adds `condition_candidate` to `trading_card_inventory_snapshot_entry` —
 * the actual resolved condition value from Pulse row parsing (e.g.
 * "NEAR_MINT"), alongside the existing `condition_source`
 * (EXPLICIT/DEFAULTED marker only, never the value itself). Mirrors
 * `finish_candidate`/`special_treatment_candidate`, which already store
 * their resolved values the same way.
 *
 * Needed for two things: pre-filling "Create card"'s Condition field (which,
 * unlike Finish and Special Treatment, previously had no source to pre-fill
 * from), and — the actual blocker — automatic card creation from a TCGdex
 * match, which has no human filling in a dropdown to supply this value.
 *
 * The schema generator's diff also proposed re-applying several other
 * already-applied changes (`card_creation_claim_token`/
 * `card_creation_claimed_at` on `trading_card_inventory_proposal`, an audit
 * action enum addition, a `matched_via` check constraint addition) from the
 * same stale-snapshot cause as `Migration20260719163428` in the trading-cards
 * module — stripped from this migration for the same reason: several of
 * those statements are unguarded `ADD CONSTRAINT`s that fail outright if the
 * constraint already exists, which is exactly what happened on first
 * attempt.
 */
export class Migration20260719170614 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry" add column if not exists "condition_candidate" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry" drop column if exists "condition_candidate";`);
  }

}
