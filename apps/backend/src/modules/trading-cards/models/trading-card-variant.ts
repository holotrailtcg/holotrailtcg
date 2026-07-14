import { model } from "@medusajs/framework/utils"
import TradingCard from "./trading-card"
import {
  CARD_CONDITION, CARD_FINISH, CONDITION_SOURCE, RECORD_ORIGIN, SPECIAL_TREATMENT,
} from "../types"

const TradingCardVariant = model
  .define({ name: "TradingCardVariant", tableName: "trading_card_variant" }, {
    id: model.id({ prefix: "tcvar" }).primaryKey(),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- Medusa ESLint 2.16 resolves same-module relative paths with Windows separators incorrectly.
    trading_card: model.belongsTo(() => TradingCard),
    condition: model.enum(Object.values(CARD_CONDITION)),
    condition_source: model.enum(Object.values(CONDITION_SOURCE)),
    finish: model.enum(Object.values(CARD_FINISH)),
    finish_confirmed: model.boolean().default(false),
    special_treatment: model.enum(Object.values(SPECIAL_TREATMENT)).default(SPECIAL_TREATMENT.NONE),
    special_treatment_confirmed: model.boolean().default(true),
    sku: model.text(),
    origin: model.enum(Object.values(RECORD_ORIGIN)).default(RECORD_ORIGIN.MANUAL),
    price_locked: model.boolean().default(false),
    price_locked_at: model.dateTime().nullable(),
    price_locked_actor: model.text().nullable(),
    price_lock_reason: model.text().nullable(),
    is_high_value_track_individually: model.boolean().default(false),
  })
  .indexes([
    {
      name: "IDX_trading_card_variant_identity",
      on: ["trading_card_id", "condition", "finish", "special_treatment"],
      unique: true,
    },
    { name: "IDX_trading_card_variant_sku", on: ["sku"], unique: true },
  ])
  .checks([
    {
      name: "CK_trading_card_variant_sku_length",
      expression: (columns) => `length(${columns.sku}) between 1 and 128`,
    },
    {
      name: "CK_trading_card_variant_sku_charset",
      expression: (columns) => `${columns.sku} ~ '^[A-Z0-9_-]+$'`,
    },
    {
      name: "CK_trading_card_variant_price_lock_consistency",
      expression: (columns) =>
        `(${columns.price_locked} and ${columns.price_locked_at} is not null and ${columns.price_locked_actor} is not null) or ` +
        `(not ${columns.price_locked} and ${columns.price_locked_at} is null and ${columns.price_locked_actor} is null and ${columns.price_lock_reason} is null)`,
    },
    {
      name: "CK_trading_card_variant_normal_finish_confirmed",
      expression: (columns) => `${columns.finish} <> 'NORMAL' or ${columns.finish_confirmed}`,
    },
  ])

export default TradingCardVariant
