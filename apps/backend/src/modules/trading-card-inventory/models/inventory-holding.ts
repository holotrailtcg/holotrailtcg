import { model } from "@medusajs/framework/utils"
import InventorySource from "./inventory-source"
import { INVENTORY_HOLDING_STATUS } from "../types"

const InventoryHolding = model
  .define({ name: "InventoryHolding", tableName: "trading_card_inventory_holding" }, {
    id: model.id({ prefix: "tcihold" }).primaryKey(),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- Medusa ESLint 2.16 resolves same-module relative paths with Windows separators incorrectly.
    inventory_source: model.belongsTo(() => InventorySource),
    trading_card_variant_id: model.text(),
    status: model.enum(Object.values(INVENTORY_HOLDING_STATUS)).default(INVENTORY_HOLDING_STATUS.DRAFT),
    quantity: model.number().default(0),
    currency_code: model.text().nullable(),
    unit_acquisition_cost: model.bigNumber().nullable(),
    unit_market_price: model.bigNumber().nullable(),
    unit_selling_price: model.bigNumber().nullable(),
    provider_reference: model.text().nullable(),
    source_observed_at: model.dateTime().nullable(),
  })
  .indexes([
    {
      name: "IDX_trading_card_inventory_holding_source_variant",
      on: ["inventory_source_id", "trading_card_variant_id"],
      unique: true,
      where: "deleted_at is null",
    },
    {
      name: "IDX_trading_card_inventory_holding_variant",
      on: ["trading_card_variant_id"],
    },
  ])
  .checks([
    {
      name: "CK_trading_card_inventory_holding_quantity_non_negative",
      expression: (columns) => `${columns.quantity} >= 0`,
    },
    {
      name: "CK_trading_card_inventory_holding_currency_format",
      expression: (columns) => `${columns.currency_code} is null or ${columns.currency_code} ~ '^[A-Z]{3}$'`,
    },
    {
      name: "CK_trading_card_inventory_holding_amounts_require_currency",
      expression: (columns) =>
        `(${columns.unit_acquisition_cost} is null and ${columns.unit_market_price} is null and ${columns.unit_selling_price} is null) or ` +
        `${columns.currency_code} is not null`,
    },
    {
      name: "CK_trading_card_inventory_holding_provider_reference_length",
      expression: (columns) => `length(${columns.provider_reference}) <= 255`,
    },
  ])

export default InventoryHolding
