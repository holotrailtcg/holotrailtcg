import ProductModule from "@medusajs/medusa/product"
import { defineLink } from "@medusajs/framework/utils"
import TradingCardsModule from "../modules/trading-cards"

export default defineLink(
  { linkable: ProductModule.linkable.product, isList: false },
  { linkable: TradingCardsModule.linkable.tradingCard, isList: false }
)
