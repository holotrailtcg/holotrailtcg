import { model } from "@medusajs/framework/utils"
import InventorySnapshotEntry from "./inventory-snapshot-entry"
import InventorySnapshot from "./inventory-snapshot"
import { INVENTORY_DIAGNOSTIC_PHASE, INVENTORY_DIAGNOSTIC_SEVERITY } from "../types"

/**
 * Stage 5B.1: append-only diagnostics for a snapshot entry. A row is never
 * updated or removed once written — a matching retry appends new MATCHING
 * diagnostics alongside the original PARSE ones rather than replacing them.
 */
const InventorySnapshotEntryDiagnostic = model
  .define({ name: "InventorySnapshotEntryDiagnostic", tableName: "trading_card_inventory_snapshot_entry_diagnostic" }, {
    id: model.id({ prefix: "tcisediag" }).primaryKey(),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- same-module relation.
    snapshot_entry: model.belongsTo(() => InventorySnapshotEntry),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- same-module relation.
    inventory_snapshot: model.belongsTo(() => InventorySnapshot),
    row_number: model.number(),
    phase: model.enum(Object.values(INVENTORY_DIAGNOSTIC_PHASE)),
    code: model.text(),
    severity: model.enum(Object.values(INVENTORY_DIAGNOSTIC_SEVERITY)),
    field_ref: model.text().nullable(),
    message: model.text(),
  })
  .indexes([
    { name: "IDX_tci_snapshot_entry_diagnostic_entry", on: ["snapshot_entry_id"] },
    { name: "IDX_tci_snapshot_entry_diagnostic_snapshot_severity", on: ["inventory_snapshot_id", "severity"] },
  ])
  .checks([
    { name: "CK_tci_snapshot_entry_diagnostic_code_length", expression: (columns) => `length(${columns.code}) between 1 and 64` },
    { name: "CK_tci_snapshot_entry_diagnostic_field_ref_length", expression: (columns) => `length(${columns.field_ref}) <= 64` },
    { name: "CK_tci_snapshot_entry_diagnostic_message_length", expression: (columns) => `length(${columns.message}) between 1 and 500` },
  ])

export default InventorySnapshotEntryDiagnostic
