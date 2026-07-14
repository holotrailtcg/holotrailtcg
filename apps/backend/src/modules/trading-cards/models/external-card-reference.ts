import { model } from "@medusajs/framework/utils"
import TradingCard from "./trading-card"
import TradingCardVariant from "./trading-card-variant"
import { CARD_LANGUAGE, EXTERNAL_PROVIDER } from "../types"

const ExternalCardReference = model
  .define({ name: "ExternalCardReference", tableName: "trading_card_external_reference" }, {
    id: model.id({ prefix: "tcref" }).primaryKey(),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- Medusa ESLint 2.16 resolves same-module relative paths with Windows separators incorrectly.
    trading_card: model.belongsTo(() => TradingCard),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- Medusa ESLint 2.16 resolves same-module relative paths with Windows separators incorrectly.
    trading_card_variant: model.belongsTo(() => TradingCardVariant).nullable(),
    provider: model.enum(Object.values(EXTERNAL_PROVIDER)),
    provider_identifier: model.text(),
    language: model.enum(Object.values(CARD_LANGUAGE)).nullable(),
    region: model.text().nullable(),
    raw_payload_note: model.text().nullable(),
  })
  .indexes([{
    name: "IDX_trading_card_external_reference_provider_identifier",
    on: ["provider", "provider_identifier"],
    unique: true,
  }])

export default ExternalCardReference
