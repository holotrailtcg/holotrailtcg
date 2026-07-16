import { model } from "@medusajs/framework/utils"
import InventorySnapshotEntry from "./inventory-snapshot-entry"
import InventorySnapshot from "./inventory-snapshot"
import { INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS, INVENTORY_SNAPSHOT_ENTRY_MATCHED_VIA } from "../types"

/**
 * Stage 5B.1: the mutable counterpart to an immutable `InventorySnapshotEntry`
 * row — matching can be retried, so its result lives here rather than on the
 * entry itself. One row per entry.
 */
const InventorySnapshotEntryMatch = model
  .define({ name: "InventorySnapshotEntryMatch", tableName: "trading_card_inventory_snapshot_entry_match" }, {
    id: model.id({ prefix: "tcisematch" }).primaryKey(),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- same-module relation.
    snapshot_entry: model.belongsTo(() => InventorySnapshotEntry),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- same-module relation.
    inventory_snapshot: model.belongsTo(() => InventorySnapshot),
    matching_status: model.enum(Object.values(INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS)).default(INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS.UNMATCHED),
    trading_card_variant_id: model.text().nullable(),
    matched_via: model.enum(Object.values(INVENTORY_SNAPSHOT_ENTRY_MATCHED_VIA)).default(INVENTORY_SNAPSHOT_ENTRY_MATCHED_VIA.NONE),
    matched_at: model.dateTime().nullable(),
    retry_count: model.number().default(0),
    last_retried_at: model.dateTime().nullable(),
  })
  .indexes([
    { name: "IDX_tci_snapshot_entry_match_entry", on: ["snapshot_entry_id"], unique: true },
    { name: "IDX_tci_snapshot_entry_match_snapshot_status", on: ["inventory_snapshot_id", "matching_status"] },
    { name: "IDX_tci_snapshot_entry_match_variant", on: ["trading_card_variant_id"] },
  ])
  .checks([
    { name: "CK_tci_snapshot_entry_match_retry_count_non_negative", expression: (columns) => `${columns.retry_count} >= 0` },
  ])

export default InventorySnapshotEntryMatch
