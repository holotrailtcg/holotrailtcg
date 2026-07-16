import { model } from "@medusajs/framework/utils"
import InventorySource from "./inventory-source"
import InventoryHolding from "./inventory-holding"
import InventorySnapshot from "./inventory-snapshot"
import { INVENTORY_NOTE_MAX_LENGTH, INVENTORY_TRANSACTION_REASON } from "../types"

const InventoryTransaction = model
  .define({ name: "InventoryTransaction", tableName: "trading_card_inventory_transaction" }, {
    id: model.id({ prefix: "tcitxn" }).primaryKey(),
    trading_card_variant_id: model.text(),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- Medusa ESLint 2.16 resolves same-module relative paths with Windows separators incorrectly.
    inventory_source: model.belongsTo(() => InventorySource).nullable(),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- Medusa ESLint 2.16 resolves same-module relative paths with Windows separators incorrectly.
    inventory_holding: model.belongsTo(() => InventoryHolding).nullable(),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- Medusa ESLint 2.16 resolves same-module relative paths with Windows separators incorrectly.
    inventory_snapshot: model.belongsTo(() => InventorySnapshot).nullable(),
    quantity_before: model.number(),
    quantity_after: model.number(),
    quantity_delta: model.number(),
    reason: model.enum(Object.values(INVENTORY_TRANSACTION_REASON)),
    originating_reference: model.text().nullable(),
    actor: model.text(),
    idempotency_key: model.text().nullable(),
    note: model.text().nullable(),
  })
  .indexes([
    { name: "IDX_trading_card_inventory_transaction_variant", on: ["trading_card_variant_id"] },
    { name: "IDX_trading_card_inventory_transaction_source", on: ["inventory_source_id"] },
    {
      name: "IDX_trading_card_inventory_transaction_idempotency_key",
      on: ["idempotency_key"],
      unique: true,
      where: "idempotency_key is not null and deleted_at is null",
    },
  ])
  .checks([
    {
      name: "CK_trading_card_inventory_transaction_quantities_non_negative",
      expression: (columns) => `${columns.quantity_before} >= 0 and ${columns.quantity_after} >= 0`,
    },
    {
      name: "CK_trading_card_inventory_transaction_delta_consistency",
      expression: (columns) => `${columns.quantity_after} = ${columns.quantity_before} + ${columns.quantity_delta}`,
    },
    {
      name: "CK_trading_card_inventory_transaction_originating_reference_length",
      expression: (columns) => `length(${columns.originating_reference}) <= 255`,
    },
    {
      name: "CK_trading_card_inventory_transaction_note_length",
      expression: (columns) => `length(${columns.note}) <= ${INVENTORY_NOTE_MAX_LENGTH}`,
    },
  ])

export default InventoryTransaction
