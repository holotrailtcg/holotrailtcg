import ProductModule from "@medusajs/medusa/product"
import { defineLink } from "@medusajs/framework/utils"
import TradingCardsModule from "../modules/trading-cards"

export default defineLink(
  { linkable: ProductModule.linkable.productVariant, isList: false },
  { linkable: TradingCardsModule.linkable.tradingCardVariant, isList: false }
)
