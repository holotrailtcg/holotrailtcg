import { Migration } from "@medusajs/framework/mikro-orm/migrations"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * Phase 8B compatibility migration for the `cardNumberForms` policy change
 * (denominator stripped, case uppercase-folded — see
 * `src/modules/trading-cards/identity/card-number.ts`). Every row written
 * before that change stored `card_number_normalised` with the denominator
 * still attached and its original case (e.g. "044/072", "025a"); every
 * reader now goes through the new algorithm (denominator-stripped,
 * uppercase-folded, e.g. "044", "025A"), so a legacy row would silently stop
 * being found by lookup/dedup/Pulse-matching queries — risking a duplicate
 * TradingCard being created for a card that already exists.
 *
 * Re-normalises every existing row to the same shape the new algorithm
 * would produce, using the *stored* `card_number_normalised` as the source
 * (not `card_number`) — that column was already trim+NFC-normalised by the
 * old algorithm, so `upper(split_part(value, '/', 1))` reproduces the new
 * algorithm's output exactly, without depending on any current-session TS
 * code from raw SQL.
 *
 * Safety: aborts the entire migration (the DO block raises, rolling back
 * the transaction) if re-normalising would make two currently-distinct
 * `trading_card` rows collide on `(card_set_id, card_number_normalised)` —
 * this is never expected to happen (denominator is redundant with the
 * card's own CardSet, not an independent identity signal) but must never be
 * silently resolved by merging or deleting either row. If it is ever hit,
 * an operator must inspect and manually resolve the colliding rows (e.g.
 * archive a genuine duplicate) before this migration can succeed.
 *
 * Not reversible: the original denominator and case are not recoverable
 * from the migrated value, so `down()` refuses to run rather than fabricate
 * data.
 */
export class Migration20260718160000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      do $$
      declare
        collision_count integer;
        collision_details text;
      begin
        select count(*), string_agg(format('(card_set_id=%s, normalised=%s, rows=%s)', card_set_id, new_normalised, row_count), '; ')
          into collision_count, collision_details
        from (
          select card_set_id, upper(split_part(card_number_normalised, '/', 1)) as new_normalised, count(*) as row_count
          from trading_card
          where deleted_at is null
          group by card_set_id, upper(split_part(card_number_normalised, '/', 1))
          having count(*) > 1
        ) collisions;

        if collision_count > 0 then
          raise exception 'Migration20260718160000: % card_set_id/card_number_normalised collision group(s) would result from re-normalising existing trading_card rows to the new denominator-stripped, uppercase-folded form. Refusing to merge or delete either side automatically. Resolve manually first: %', collision_count, collision_details;
        end if;

        update trading_card
        set card_number_normalised = upper(split_part(card_number_normalised, '/', 1)),
            updated_at = now()
        where deleted_at is null
          and card_number_normalised <> upper(split_part(card_number_normalised, '/', 1));
      end $$;
    `)
  }

  override async down(): Promise<void> {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Migration20260718160000 is not reversible: the original denominator and letter case stripped from card_number_normalised by up() cannot be reconstructed. " +
      "If you need to roll back, restore card_number_normalised from a database backup taken before this migration ran."
    )
  }
}
