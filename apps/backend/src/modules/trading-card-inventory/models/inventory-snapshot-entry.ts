import { model } from "@medusajs/framework/utils"
import InventorySnapshot from "./inventory-snapshot"
import { INVENTORY_PROVIDER_REFERENCE_TYPE, INVENTORY_SNAPSHOT_ENTRY_OUTCOME, INVENTORY_CONDITION_SOURCE } from "../types"

/**
 * Stage 5A.2 immutable normalized-fact row, extended in Stage 5B.1 with
 * write-once parse-time columns only (row_number, outcome, and bounded
 * parsed-candidate fields) — nothing added here is ever updated after a
 * row's single insert. Matching results, which *can* be retried, live on
 * the separate mutable `InventorySnapshotEntryMatch` row instead.
 */
const InventorySnapshotEntry = model
  .define({ name: "InventorySnapshotEntry", tableName: "trading_card_inventory_snapshot_entry" }, {
    id: model.id({ prefix: "tcisentry" }).primaryKey(),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- same-module relation.
    inventory_snapshot: model.belongsTo(() => InventorySnapshot),
    provider_reference: model.text(),
    provider_reference_type: model.enum(Object.values(INVENTORY_PROVIDER_REFERENCE_TYPE)),
    trading_card_variant_id: model.text().nullable(),
    quantity: model.number(),
    currency_code: model.text().nullable(),
    unit_acquisition_cost: model.bigNumber().nullable(),
    unit_market_price: model.bigNumber().nullable(),
    unit_selling_price: model.bigNumber().nullable(),
    row_number: model.number().nullable(),
    outcome: model.enum(Object.values(INVENTORY_SNAPSHOT_ENTRY_OUTCOME)).nullable(),
    condition_source: model.enum(Object.values(INVENTORY_CONDITION_SOURCE)).nullable(),
    condition_candidate: model.text().nullable(),
    finish_candidate: model.text().nullable(),
    special_treatment_candidate: model.text().nullable(),
    rarity_candidate: model.text().nullable(),
    rarity_raw: model.text().nullable(),
    language_conflict: model.boolean().default(false),
    /** Stage 1: "Does this card require a separate listing?" — upload-level default, or a per-row reviewer correction. Part of the saleable grouping identity; see reconciliation/reconcile.ts. */
    requires_separate_listing: model.boolean().default(false),
    raw_fields: model.json().nullable(),
  })
  .indexes([
    { name: "IDX_tci_snapshot_entry_snapshot_reference", on: ["inventory_snapshot_id", "provider_reference_type", "provider_reference"] },
    { name: "IDX_tci_snapshot_entry_variant", on: ["trading_card_variant_id"] },
    { name: "IDX_tci_snapshot_entry_row_number", on: ["inventory_snapshot_id", "row_number"], unique: true, where: "row_number is not null" },
    { name: "IDX_tci_snapshot_entry_outcome", on: ["inventory_snapshot_id", "outcome"] },
  ])
  .checks([
    { name: "CK_tci_snapshot_entry_quantity_non_negative", expression: (columns) => `${columns.quantity} >= 0` },
    { name: "CK_tci_snapshot_entry_reference_length", expression: (columns) => `length(${columns.provider_reference}) between 1 and 255` },
    { name: "CK_tci_snapshot_entry_currency_format", expression: (columns) => `${columns.currency_code} is null or ${columns.currency_code} ~ '^[A-Z]{3}$'` },
    { name: "CK_tci_snapshot_entry_amounts_require_currency", expression: (columns) =>
      `(${columns.unit_acquisition_cost} is null and ${columns.unit_market_price} is null and ${columns.unit_selling_price} is null) or ${columns.currency_code} is not null` },
  ])

export default InventorySnapshotEntry
