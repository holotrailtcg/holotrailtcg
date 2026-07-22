import type { IProductModuleService, MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"

/** The single, fixed Product Type every trading-card Product is created with — see `create-card-from-inventory-row.ts`. */
export const TRADING_CARD_PRODUCT_TYPE_VALUE = "Trading Card"

/**
 * Looks up-or-creates the single `"Trading Card"` Product Type, idempotently.
 * Every trading-card Product uses this same Type — there is no per-card
 * variation, so this never takes an input beyond the container.
 */
export async function ensureTradingCardProductType(container: MedusaContainer): Promise<string> {
  const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const [existing] = await products.listProductTypes({ value: TRADING_CARD_PRODUCT_TYPE_VALUE }, { take: 1 })
  if (existing) return existing.id
  try {
    const created = await products.createProductTypes({ value: TRADING_CARD_PRODUCT_TYPE_VALUE })
    return created.id
  } catch (error) {
    // Concurrent creation race — another request created it between our lookup and insert.
    const [afterRace] = await products.listProductTypes({ value: TRADING_CARD_PRODUCT_TYPE_VALUE }, { take: 1 })
    if (afterRace) return afterRace.id
    throw error
  }
}

/**
 * Looks up-or-creates a Product Collection titled `seriesName`, idempotently.
 * One Collection per Series (e.g. "Scarlet & Violet"), grouping cards across
 * every Set within that Series.
 */
export async function ensureSeriesCollection(container: MedusaContainer, seriesName: string): Promise<string> {
  const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const [existing] = await products.listProductCollections({ title: seriesName }, { take: 1 })
  if (existing) return existing.id
  try {
    const created = await products.createProductCollections({ title: seriesName })
    return created.id
  } catch (error) {
    const [afterRace] = await products.listProductCollections({ title: seriesName }, { take: 1 })
    if (afterRace) return afterRace.id
    throw error
  }
}

/**
 * Resolves the Series display name for a Set, via `ProviderSetMapping` — the
 * same (provider-agnostic) lookup path `get-inventory-overview.ts`'s
 * `loadSeriesByCardSetKey` uses for the Card Inventory page's "Series"
 * column, scoped here to a single set instead of loading every mapping.
 * Returns `null` if no mapping (or no series name on it) exists yet — series
 * assignment should never block card creation.
 */
export async function resolveSeriesName(
  cards: TradingCardsModuleService, game: string, language: string, providerSetCode: string,
): Promise<string | null> {
  const [mapping] = await cards.listProviderSetMappings(
    { game, language, provider_set_code: providerSetCode },
    { take: 1 },
  )
  const seriesName = (mapping as { tcgdex_series_name?: string | null } | undefined)?.tcgdex_series_name
  return seriesName ?? null
}

export { TRADING_CARDS_MODULE }
