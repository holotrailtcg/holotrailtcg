import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Stage 1 (import identity & review corrections): adds the
 * `requires_separate_listing` upload/row-level intent field described in the
 * Stage 1 spec — "Does this card require a separate listing?". Persisted on
 * both the immutable snapshot entry (the upload-level default, or a later
 * per-row correction) and the proposal (the reviewer-facing, overridable
 * value used for grouping). Defaults to `false` on existing rows since no
 * prior import ever recorded listing intent — a safe, non-destructive
 * default per the Stage 1 data-modelling requirements. This field does not
 * yet drive stock application or physical-copy behaviour (out of scope for
 * this stage); it only participates in grouping so that rows explicitly
 * marked true never merge with rows marked false.
 */
export class Migration20260722130000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry"
      add column if not exists "requires_separate_listing" boolean not null default false;`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      add column if not exists "requires_separate_listing" boolean not null default false;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      drop column if exists "requires_separate_listing";`)
    this.addSql(`alter table if exists "trading_card_inventory_snapshot_entry"
      drop column if exists "requires_separate_listing";`)
  }
}
