import { model } from "@medusajs/framework/utils"
import CardSet from "./card-set"
import { RARITY, RARITY_ICON_KEY, RECORD_ORIGIN } from "../types"

const TradingCard = model
  .define({ name: "TradingCard", tableName: "trading_card" }, {
    id: model.id({ prefix: "tcard" }).primaryKey(),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- Medusa ESLint 2.16 resolves same-module relative paths with Windows separators incorrectly.
    card_set: model.belongsTo(() => CardSet),
    name: model.text(),
    search_name: model.text(),
    slug: model.text().nullable(),
    card_number: model.text(),
    card_number_normalised: model.text(),
    rarity_raw: model.text().nullable(),
    rarity_comparison: model.text().nullable(),
    rarity: model.enum(Object.values(RARITY)).nullable(),
    rarity_icon_key: model.enum(Object.values(RARITY_ICON_KEY)).nullable(),
    origin: model.enum(Object.values(RECORD_ORIGIN)).default(RECORD_ORIGIN.MANUAL),
    /**
     * Stage 1: optional canonical-card metadata — never part of saleable
     * identity/grouping. `illustrator_confirmed` guards against an
     * unapproved provider value silently overwriting a reviewer's manual
     * correction — see `updateTradingCardIdentity`.
     */
    illustrator: model.text().nullable(),
    illustrator_confirmed: model.boolean().default(false),
  })
  .indexes([{
    name: "IDX_trading_card_identity",
    on: ["card_set_id", "card_number_normalised"],
    unique: true,
  }])
  .checks([{
    name: "CK_trading_card_rarity_mapping_pair",
    expression: (columns) =>
      `(${columns.rarity} is null and ${columns.rarity_icon_key} is null) or ` +
      `(${columns.rarity} is not null and ${columns.rarity_icon_key} is not null)`,
  }, {
    name: "CK_trading_card_rarity_raw_pair",
    expression: (columns) =>
      `(${columns.rarity_raw} is null and ${columns.rarity_comparison} is null) or ` +
      `(${columns.rarity_raw} is not null and ${columns.rarity_comparison} is not null)`,
  }, {
    name: "CK_trading_card_illustrator_length",
    expression: (columns) => `length(${columns.illustrator}) <= 255`,
  }])

export default TradingCard
