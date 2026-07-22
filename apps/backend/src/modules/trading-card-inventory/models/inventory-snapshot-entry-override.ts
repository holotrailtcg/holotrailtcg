import { model } from "@medusajs/framework/utils"
import InventorySnapshotEntry from "./inventory-snapshot-entry"
import InventorySnapshot from "./inventory-snapshot"

/**
 * Stage 1: reviewer corrections to a single immutable snapshot entry's
 * grouping/listing intent, kept in a separate mutable table rather than on
 * `InventorySnapshotEntry` itself (which is append-only/immutable — see its
 * own doc comment). One row per entry (unique on `snapshot_entry_id`).
 *
 * `split_group_key` is an opaque token minted by `splitInventoryProposal`:
 * when set, it is appended to the entry's reconciliation grouping key (see
 * `reconciliation/reconcile.ts`), so a reviewer-selected subset of a
 * proposal's rows stops merging with the rest even though their parsed
 * condition/finish/treatment/variant are otherwise identical. Rows that
 * were never split keep this null and group exactly as Phase 1 already
 * computes.
 *
 * `requires_separate_listing_override` is the Stage 1 per-row/group review
 * correction to the upload-level "does this card require a separate
 * listing?" default; when non-null it takes precedence over the entry's
 * parsed `requires_separate_listing` value everywhere grouping is computed.
 */
const InventorySnapshotEntryOverride = model
  .define({ name: "InventorySnapshotEntryOverride", tableName: "trading_card_inventory_snapshot_entry_override" }, {
    id: model.id({ prefix: "tciseovr" }).primaryKey(),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- same-module relation.
    snapshot_entry: model.belongsTo(() => InventorySnapshotEntry),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- same-module relation.
    inventory_snapshot: model.belongsTo(() => InventorySnapshot),
    split_group_key: model.text().nullable(),
    requires_separate_listing_override: model.boolean().nullable(),
  })
  .indexes([
    { name: "IDX_tci_snapshot_entry_override_entry", on: ["snapshot_entry_id"], unique: true, where: "deleted_at is null" },
    { name: "IDX_tci_snapshot_entry_override_snapshot", on: ["inventory_snapshot_id"] },
  ])
  .checks([
    { name: "CK_tci_snapshot_entry_override_split_key_length", expression: (columns) => `length(${columns.split_group_key}) <= 64` },
  ])

export default InventorySnapshotEntryOverride
