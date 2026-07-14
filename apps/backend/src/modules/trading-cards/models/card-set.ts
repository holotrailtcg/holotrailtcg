import { model } from "@medusajs/framework/utils"
import { CARD_GAME, CARD_LANGUAGE } from "../types"

const CardSet = model
  .define({ name: "CardSet", tableName: "trading_card_set" }, {
    id: model.id({ prefix: "tcset" }).primaryKey(),
    game: model.enum(Object.values(CARD_GAME)).default(CARD_GAME.POKEMON),
    language: model.enum(Object.values(CARD_LANGUAGE)),
    display_name: model.text(),
    provider_set_code: model.text(),
    holo_trail_set_key: model.text().nullable(),
    release_date: model.dateTime().nullable(),
  })
  .indexes([{
    name: "IDX_trading_card_set_identity",
    on: ["game", "language", "provider_set_code"],
    unique: true,
  }])

export default CardSet
