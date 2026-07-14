import { model } from "@medusajs/framework/utils"
import { CARD_LANGUAGE, EXTERNAL_PROVIDER, RARITY, RARITY_ICON_KEY } from "../types"

const RarityMapping = model
  .define({ name: "RarityMapping", tableName: "trading_card_rarity_mapping" }, {
    id: model.id({ prefix: "tcrar" }).primaryKey(),
    provider: model.enum(Object.values(EXTERNAL_PROVIDER)),
    language: model.enum(Object.values(CARD_LANGUAGE)).nullable(),
    raw_value: model.text(),
    comparison_value: model.text(),
    rarity: model.enum(Object.values(RARITY)),
    icon_key: model.enum(Object.values(RARITY_ICON_KEY)),
  })
  .indexes([
    {
      name: "IDX_trading_card_rarity_mapping_global",
      on: ["provider", "comparison_value"],
      where: { language: null },
      unique: true,
    },
    {
      name: "IDX_trading_card_rarity_mapping_language",
      on: ["provider", "language", "comparison_value"],
      where: { language: { $ne: null } },
      unique: true,
    },
  ])

export default RarityMapping
