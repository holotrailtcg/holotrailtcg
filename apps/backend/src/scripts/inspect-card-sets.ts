import type { MedusaContainer } from "@medusajs/framework"
import { TRADING_CARDS_MODULE } from "../modules/trading-cards"
import type TradingCardsModuleService from "../modules/trading-cards/service"

/**
 * Read-only diagnostic: dumps every CardSet row currently on file, to check
 * the real `provider_set_code` format before writing SET_CODE conditions
 * for eBay category-assignment rules.
 *
 * Usage: pnpm exec medusa exec ./src/scripts/inspect-card-sets.ts
 */
export default async function inspectCardSets({ container }: { container: MedusaContainer }) {
  const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
  const sets = await cards.listCardSets({}, { take: 50 })
  console.log(JSON.stringify(sets, null, 2))
}
