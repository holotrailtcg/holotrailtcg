import { defineLink } from "@medusajs/framework/utils"
import TradingCardInventoryModule from "../modules/trading-card-inventory"
import TradingCardsModule from "../modules/trading-cards"

/**
 * Purely for `query.graph()` traversal from a trading-card variant to its
 * source-specific holdings in Admin reads (e.g. publish readiness). Many
 * holdings — one per inventory source — can link to the same variant, so
 * each link row is unique per holding even though `isList: false` on both
 * sides (matching the existing `trading-card-variant-product-variant.ts`
 * link's cardinality convention).
 */
export default defineLink(
  { linkable: TradingCardInventoryModule.linkable.inventoryHolding, isList: false },
  { linkable: TradingCardsModule.linkable.tradingCardVariant, isList: false }
)
