import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Widens the "is this content-hash still live" partial unique index
 * (`IDX_trading_card_inventory_snapshot_live_content_hash`, first created by
 * Migration20260716090000 and left unchanged by Migration20260717231314,
 * which only added the DISCARDED status value itself) to also exclude
 * DISCARDED snapshots.
 *
 * Without this, a discarded snapshot's content hash is still treated as
 * "live" by the uniqueness check, so re-uploading the exact same CSV after
 * discarding it is wrongly rejected as a duplicate of the very import the
 * reviewer just discarded. This migration is purely additive to the index
 * predicate (widens which rows are excluded) and depends only on the
 * DISCARDED status value already being a valid `status` CHECK value, which
 * Migration20260717231314 already guarantees. It is safe to apply whether or
 * not any DISCARDED rows currently exist, and safe to re-apply (index
 * creation is `if not exists`).
 *
 * Rollback precondition: `down()` restores the narrower predicate
 * (`status not in ('REJECTED', 'FAILED')`), which once again counts a
 * DISCARDED row as "live". If a snapshot was discarded and its exact content
 * hash was then re-uploaded while this migration was applied — the scenario
 * this migration exists to allow — two rows with the same
 * (inventory_source_id, content_hash) now legitimately coexist: the
 * DISCARDED original and the new live snapshot. Recreating the narrower
 * index in `down()` will fail with a unique-constraint violation in that
 * case. There is no data-preserving automatic resolution: an operator must
 * decide which of the conflicting snapshots keeps its content_hash (e.g. by
 * nulling it out on the DISCARDED row) before `down()` can succeed. Rollback
 * is otherwise safe when no such reuse has occurred.
 */
export class Migration20260718150000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`drop index if exists "IDX_trading_card_inventory_snapshot_live_content_hash";`)
    this.addSql(`create unique index if not exists "IDX_trading_card_inventory_snapshot_live_content_hash"
      on "trading_card_inventory_snapshot" ("inventory_source_id", "content_hash")
      where content_hash is not null and deleted_at is null and status not in ('REJECTED', 'FAILED', 'DISCARDED');`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_trading_card_inventory_snapshot_live_content_hash";`)
    this.addSql(`create unique index if not exists "IDX_trading_card_inventory_snapshot_live_content_hash"
      on "trading_card_inventory_snapshot" ("inventory_source_id", "content_hash")
      where content_hash is not null and deleted_at is null and status not in ('REJECTED', 'FAILED');`)
  }
}
