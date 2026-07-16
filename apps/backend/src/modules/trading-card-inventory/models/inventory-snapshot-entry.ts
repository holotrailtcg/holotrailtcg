import { model } from "@medusajs/framework/utils"
import InventorySnapshot from "./inventory-snapshot"
import { INVENTORY_PROVIDER_REFERENCE_TYPE } from "../types"

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
  })
  .indexes([
    { name: "IDX_tci_snapshot_entry_snapshot_reference", on: ["inventory_snapshot_id", "provider_reference_type", "provider_reference"] },
    { name: "IDX_tci_snapshot_entry_variant", on: ["trading_card_variant_id"] },
  ])
  .checks([
    { name: "CK_tci_snapshot_entry_quantity_non_negative", expression: (columns) => `${columns.quantity} >= 0` },
    { name: "CK_tci_snapshot_entry_reference_length", expression: (columns) => `length(${columns.provider_reference}) between 1 and 255` },
    { name: "CK_tci_snapshot_entry_currency_format", expression: (columns) => `${columns.currency_code} is null or ${columns.currency_code} ~ '^[A-Z]{3}$'` },
    { name: "CK_tci_snapshot_entry_amounts_require_currency", expression: (columns) =>
      `(${columns.unit_acquisition_cost} is null and ${columns.unit_market_price} is null and ${columns.unit_selling_price} is null) or ${columns.currency_code} is not null` },
  ])

export default InventorySnapshotEntry
