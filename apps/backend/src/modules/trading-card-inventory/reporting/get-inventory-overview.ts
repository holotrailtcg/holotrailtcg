import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IInventoryService } from "@medusajs/framework/types"
import { TRADING_CARDS_MODULE } from "../../trading-cards"
import type TradingCardsModuleService from "../../trading-cards/service"
import { resolveR2Config } from "../../trading-cards/images/r2-config"
import { TRADING_CARD_INVENTORY_MODULE } from "../index"
import type TradingCardInventoryModuleService from "../service"
import {
  aggregateVariantPricing, summariseInventoryOverviewTotals,
  type InventoryHoldingForAggregation, type InventoryOverviewTotals,
} from "./inventory-overview-aggregation"

export interface InventoryOverviewRow {
  tradingCardVariantId: string
  sku: string
  quantity: number
  imageUrl: string | null
  cardName: string
  series: string | null
  set: string
  purchasePrice: number
  marketValue: number
  profitAndLoss: number
  rarity: string | null
  medusaProductId: string | null
}

export interface InventoryOverviewResult {
  rows: InventoryOverviewRow[]
  count: number
  totals: InventoryOverviewTotals
}

interface VariantChainRow {
  id: string
  sku: string
  trading_card: {
    id: string
    name: string
    rarity: string | null
    rarity_raw: string | null
    card_set: {
      display_name: string
      provider_set_code: string
      game: string
      language: string
    } | null
  } | null
}

/**
 * Resolves the live Medusa `stocked_quantity` for a batch of trading-card
 * variants in two hops (variant -> product_variant -> inventory_items,
 * then inventory_item -> location_levels), matching the link-resolution
 * pattern established in `medusa-inventory-sync.ts` / `get-publish-readiness.ts`.
 * A variant with no linked Medusa inventory item (not yet published) gets 0.
 * Multiple location levels for one item are summed together.
 */
async function resolveLiveQuantities(
  container: MedusaContainer,
  variantIds: string[],
): Promise<{ quantityByVariantId: Map<string, number>; productIdByVariantId: Map<string, string | null> }> {
  const quantityByVariantId = new Map<string, number>(variantIds.map((id) => [id, 0]))
  const productIdByVariantId = new Map<string, string | null>(variantIds.map((id) => [id, null]))
  if (variantIds.length === 0) return { quantityByVariantId, productIdByVariantId }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "trading_card_variant",
    fields: ["id", "product_variant.product.id", "product_variant.inventory_items.inventory_item_id"],
    filters: { id: variantIds },
  })

  const inventoryItemIdToVariantIds = new Map<string, string[]>()
  for (const row of data as Array<{
    id: string
    product_variant?: {
      product?: { id?: string } | null
      inventory_items?: Array<{ inventory_item_id?: string }> | null
    } | null
  }>) {
    productIdByVariantId.set(row.id, row.product_variant?.product?.id ?? null)
    const links = row.product_variant?.inventory_items ?? []
    for (const link of links) {
      if (!link.inventory_item_id) continue
      const existing = inventoryItemIdToVariantIds.get(link.inventory_item_id) ?? []
      existing.push(row.id)
      inventoryItemIdToVariantIds.set(link.inventory_item_id, existing)
    }
  }

  const inventoryItemIds = [...inventoryItemIdToVariantIds.keys()]
  if (inventoryItemIds.length === 0) return { quantityByVariantId, productIdByVariantId }

  const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)
  const levels = await inventoryService.listInventoryLevels({ inventory_item_id: inventoryItemIds })
  const quantityByItemId = new Map<string, number>()
  for (const level of levels) {
    quantityByItemId.set(
      level.inventory_item_id,
      (quantityByItemId.get(level.inventory_item_id) ?? 0) + (level.stocked_quantity ?? 0),
    )
  }

  for (const [itemId, variantIdsForItem] of inventoryItemIdToVariantIds) {
    const quantity = quantityByItemId.get(itemId) ?? 0
    for (const variantId of variantIdsForItem) {
      quantityByVariantId.set(variantId, (quantityByVariantId.get(variantId) ?? 0) + quantity)
    }
  }

  return { quantityByVariantId, productIdByVariantId }
}

/**
 * Builds the "Series" column via `ProviderSetMapping`, which is keyed by
 * (provider, game, language, provider_set_code) — not a direct FK from
 * `CardSet`. `CardSet` itself carries no provider, so this matches on
 * game+language+provider_set_code only and takes the first mapping found
 * regardless of provider. In practice Pulse is currently the only provider
 * populating these mappings, so this is safe; if a second provider ever
 * supplies conflicting series names for the same set code, this would need
 * to prefer one explicitly.
 */
async function loadSeriesByCardSetKey(
  cards: TradingCardsModuleService,
): Promise<Map<string, string>> {
  const mappings = await cards.listProviderSetMappings({})
  const seriesByKey = new Map<string, string>()
  for (const mapping of mappings as Array<{
    game: string; language: string; provider_set_code: string; tcgdex_series_name: string | null
  }>) {
    if (!mapping.tcgdex_series_name) continue
    const key = `${mapping.game}|${mapping.language}|${mapping.provider_set_code}`
    if (!seriesByKey.has(key)) seriesByKey.set(key, mapping.tcgdex_series_name)
  }
  return seriesByKey
}

/**
 * Assembles the Admin "Card Inventory" overview: one row per trading-card
 * variant, with dashboard totals computed across every variant (not just
 * the current page). Read-only, no writes.
 *
 * Data-quality note: variants with no `InventoryHolding` rows, or holdings
 * with null `unit_acquisition_cost` / `unit_market_price`, show up with
 * `purchasePrice`/`marketValue` of 0 — the caller should not treat 0 as "no
 * value", only as "no priced holding data yet".
 */
export async function getInventoryOverview(
  container: MedusaContainer,
  pagination: { limit: number; offset: number },
): Promise<InventoryOverviewResult> {
  const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)

  // All variants are loaded (not just the requested page) because the
  // dashboard totals must aggregate across the entire dataset, and because
  // holdings/live-stock lookups are batched per-variant-id below; per-row
  // image lookups (the only genuinely expensive per-row cost) are deferred
  // to just the page slice further down.
  const allVariants = (await cards.listTradingCardVariants(
    {},
    { relations: ["trading_card", "trading_card.card_set"], order: { sku: "ASC" } },
  )) as unknown as VariantChainRow[]

  const variantIds = allVariants.map((variant) => variant.id)
  const [holdingsByVariantId, liveQuantityResult, seriesByCardSetKey] = await Promise.all([
    (async () => {
      const holdings = variantIds.length
        ? await inventory.listInventoryHoldings({ trading_card_variant_id: variantIds })
        : []
      const map = new Map<string, InventoryHoldingForAggregation[]>()
      for (const holding of holdings as Array<{
        trading_card_variant_id: string
        quantity: number
        unit_acquisition_cost: string | null
        unit_market_price: string | null
        source_observed_at: string | Date | null
      }>) {
        const list = map.get(holding.trading_card_variant_id) ?? []
        list.push({
          quantity: holding.quantity,
          unitAcquisitionCost: holding.unit_acquisition_cost === null ? null : String(holding.unit_acquisition_cost),
          unitMarketPrice: holding.unit_market_price === null ? null : String(holding.unit_market_price),
          sourceObservedAt: holding.source_observed_at,
        })
        map.set(holding.trading_card_variant_id, list)
      }
      return map
    })(),
    resolveLiveQuantities(container, variantIds),
    loadSeriesByCardSetKey(cards),
  ])
  const { quantityByVariantId: liveQuantityByVariantId, productIdByVariantId } = liveQuantityResult

  const computedRows = allVariants.map((variant) => {
    const liveQuantity = liveQuantityByVariantId.get(variant.id) ?? 0
    const holdings = holdingsByVariantId.get(variant.id) ?? []
    const aggregate = aggregateVariantPricing(holdings, liveQuantity)
    const cardSet = variant.trading_card?.card_set ?? null
    const seriesKey = cardSet ? `${cardSet.game}|${cardSet.language}|${cardSet.provider_set_code}` : null
    return {
      tradingCardVariantId: variant.id,
      sku: variant.sku,
      quantity: aggregate.liveQuantity,
      cardName: variant.trading_card?.name ?? "Unknown card",
      series: seriesKey ? seriesByCardSetKey.get(seriesKey) ?? null : null,
      set: cardSet?.display_name ?? "Unknown set",
      purchasePrice: aggregate.purchasePriceTotal,
      marketValue: aggregate.marketValueTotal,
      profitAndLoss: aggregate.profitAndLoss,
      rarity: variant.trading_card?.rarity ?? variant.trading_card?.rarity_raw ?? null,
      medusaProductId: productIdByVariantId.get(variant.id) ?? null,
    }
  })

  const totals = summariseInventoryOverviewTotals(
    computedRows.map((row) => ({
      liveQuantity: row.quantity, purchasePriceTotal: row.purchasePrice, marketValueTotal: row.marketValue,
    })),
  )

  const pageRows = computedRows.slice(pagination.offset, pagination.offset + pagination.limit)
  const r2Config = resolveR2Config()
  const thumbnails = await cards.listThumbnailsForVariants({
    variantIds: pageRows.map((row) => row.tradingCardVariantId),
    publicBaseUrl: r2Config.enabled ? r2Config.publicBaseUrl : null,
  })

  const rows: InventoryOverviewRow[] = pageRows.map((row) => ({
    ...row,
    imageUrl: thumbnails[row.tradingCardVariantId]?.imageUrl ?? null,
  }))

  return { rows, count: computedRows.length, totals }
}
