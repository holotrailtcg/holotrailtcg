import { model } from "@medusajs/framework/utils"
import { CARD_GAME, CARD_LANGUAGE, EXTERNAL_PROVIDER } from "../types"

/**
 * A confirmed mapping from one inventory provider's own set code (e.g.
 * Pulse's "swsh4pt5") to the real TCGdex set id (e.g. "swsh4.5"). Exists
 * independently of `CardSet` — a mapping can be confirmed before any card in
 * that set has been created locally, which is the whole point: it lets
 * automatic TCGdex lookup resolve a brand-new set's cards without requiring
 * a card to exist first.
 */
const ProviderSetMapping = model
  .define({ name: "ProviderSetMapping", tableName: "trading_card_provider_set_mapping" }, {
    id: model.id({ prefix: "tcpsm" }).primaryKey(),
    provider: model.enum(Object.values(EXTERNAL_PROVIDER)),
    game: model.enum(Object.values(CARD_GAME)),
    language: model.enum(Object.values(CARD_LANGUAGE)),
    provider_set_code: model.text(),
    tcgdex_set_id: model.text(),
    tcgdex_set_name: model.text(),
    tcgdex_series_id: model.text().nullable(),
    tcgdex_series_name: model.text().nullable(),
  })
  .indexes([
    {
      name: "IDX_trading_card_provider_set_mapping_identity",
      on: ["provider", "game", "language", "provider_set_code"],
      unique: true,
    },
  ])
  .checks([{
    name: "CK_provider_set_mapping_series_pair",
    expression: (columns) =>
      `(${columns.tcgdex_series_id} is null and ${columns.tcgdex_series_name} is null) or ` +
      `(${columns.tcgdex_series_id} is not null and ${columns.tcgdex_series_name} is not null)`,
  }])

export default ProviderSetMapping
