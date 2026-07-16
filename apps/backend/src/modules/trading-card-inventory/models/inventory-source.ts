import { model } from "@medusajs/framework/utils"
import { INVENTORY_PROVIDER, INVENTORY_SOURCE_LANGUAGE, INVENTORY_SOURCE_STATUS } from "../types"

const InventorySource = model
  .define({ name: "InventorySource", tableName: "trading_card_inventory_source" }, {
    id: model.id({ prefix: "tcisrc" }).primaryKey(),
    display_name: model.text(),
    normalized_name: model.text(),
    provider: model.enum(Object.values(INVENTORY_PROVIDER)),
    language: model.enum(Object.values(INVENTORY_SOURCE_LANGUAGE)).nullable(),
    status: model.enum(Object.values(INVENTORY_SOURCE_STATUS)).default(INVENTORY_SOURCE_STATUS.ACTIVE),
    provider_metadata: model.json().nullable(),
    default_currency_code: model.text().nullable(),
    default_pricing_profile_key: model.text().nullable(),
    default_storefront_category_id: model.text().nullable(),
    notes: model.text().nullable(),
  })
  .indexes([
    {
      name: "IDX_trading_card_inventory_source_normalized_name",
      on: ["normalized_name"],
      unique: true,
      where: "deleted_at is null",
    },
  ])
  .checks([
    {
      name: "CK_trading_card_inventory_source_currency_format",
      expression: (columns) => `${columns.default_currency_code} is null or ${columns.default_currency_code} ~ '^[A-Z]{3}$'`,
    },
    {
      name: "CK_trading_card_inventory_source_notes_length",
      expression: (columns) => `length(${columns.notes}) <= 1000`,
    },
    {
      name: "CK_trading_card_inventory_source_metadata_bounded",
      expression: (columns) => `${columns.provider_metadata} is null or octet_length(${columns.provider_metadata}::text) <= 2000`,
    },
  ])

export default InventorySource
