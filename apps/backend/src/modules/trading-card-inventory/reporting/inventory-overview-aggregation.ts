/**
 * Pure aggregation math for the Admin "Card Inventory" overview page. Kept
 * free of any DB/module dependency so it can be unit-tested directly — all
 * DB reads (holdings, live Medusa stock) happen in the caller, which passes
 * already-loaded plain data in.
 *
 * Pricing convention: money fields are the same string-encoded bigNumber
 * values used everywhere else in this module (see `InventoryHolding`'s
 * `unit_acquisition_cost` / `unit_market_price`), so all arithmetic here
 * goes through `Number(...)` the same way `toSafeInventoryProposalDto` does
 * when it re-stringifies bigNumber fields for the Admin API.
 */

export interface InventoryHoldingForAggregation {
  quantity: number
  unitAcquisitionCost: string | null
  unitMarketPrice: string | null
  sourceObservedAt: string | Date | null
}

export interface VariantPricingAggregate {
  /** Weighted average of `unitAcquisitionCost` across holdings, weighted by each holding's own `quantity`. Null if no holding has cost data. */
  avgUnitAcquisitionCost: number | null
  /** `unitMarketPrice` from the holding with the most recent `sourceObservedAt` (holdings with a null price are skipped when picking "most recent"). */
  currentUnitMarketPrice: number | null
  /** The variant's live Medusa stocked quantity — always the row quantity, never a holding's own `quantity`. */
  liveQuantity: number
  /** `liveQuantity * avgUnitAcquisitionCost`, or 0 if there is no cost data. */
  purchasePriceTotal: number
  /** `liveQuantity * currentUnitMarketPrice`, or 0 if there is no market data. */
  marketValueTotal: number
  /** `marketValueTotal - purchasePriceTotal`. Can be negative. */
  profitAndLoss: number
}

/**
 * Aggregates every `InventoryHolding` row for a single trading-card variant
 * into the figures the overview table and dashboard totals need. `holdings`
 * may be empty (a variant with no recorded holding yet still gets a row,
 * all money fields null/zero) or contain many rows (one per inventory
 * source).
 */
export function aggregateVariantPricing(
  holdings: InventoryHoldingForAggregation[],
  liveQuantity: number,
): VariantPricingAggregate {
  let costWeightedSum = 0
  let costWeightTotal = 0
  for (const holding of holdings) {
    if (holding.unitAcquisitionCost === null) continue
    const cost = Number(holding.unitAcquisitionCost)
    if (!Number.isFinite(cost)) continue
    const weight = Math.max(holding.quantity, 0)
    costWeightedSum += cost * weight
    costWeightTotal += weight
  }
  const avgUnitAcquisitionCost = costWeightTotal > 0 ? costWeightedSum / costWeightTotal : null

  let mostRecentPrice: number | null = null
  let mostRecentTimestamp: number | null = null
  for (const holding of holdings) {
    if (holding.unitMarketPrice === null) continue
    const price = Number(holding.unitMarketPrice)
    if (!Number.isFinite(price)) continue
    const observedAt = holding.sourceObservedAt ? new Date(holding.sourceObservedAt).getTime() : null
    if (observedAt === null || Number.isNaN(observedAt)) continue
    if (mostRecentTimestamp === null || observedAt > mostRecentTimestamp) {
      mostRecentTimestamp = observedAt
      mostRecentPrice = price
    }
  }
  const currentUnitMarketPrice = mostRecentPrice

  const purchasePriceTotal = avgUnitAcquisitionCost !== null ? liveQuantity * avgUnitAcquisitionCost : 0
  const marketValueTotal = currentUnitMarketPrice !== null ? liveQuantity * currentUnitMarketPrice : 0
  const profitAndLoss = marketValueTotal - purchasePriceTotal

  return {
    avgUnitAcquisitionCost,
    currentUnitMarketPrice,
    liveQuantity,
    purchasePriceTotal,
    marketValueTotal,
    profitAndLoss,
  }
}

export interface InventoryOverviewTotals {
  totalCards: number
  totalPurchasePrice: number
  totalMarketValue: number
}

/**
 * Dashboard totals across every row (not just the current page).
 *
 * `totalCards` counts distinct card-variant rows that currently have stock
 * (`liveQuantity > 0`) rather than summing unit quantities. Rationale: this
 * page is one row per sellable card line, and "Total Cards" reads most
 * naturally as "how many different card lines do we hold stock of" — the
 * same way a shopkeeper would count "how many things are on the shelf", not
 * the total unit count (which would make one line of 50 commons dwarf 50
 * distinct rare singles). Rows with zero live stock are excluded so the
 * count reflects the current shelf, not import/catalogue history. This is a
 * judgement call — a "total units in stock" figure is a legitimate
 * alternative reading and may be worth surfacing as a second tile later.
 */
export function summariseInventoryOverviewTotals(
  rows: Array<{ liveQuantity: number; purchasePriceTotal: number; marketValueTotal: number }>,
): InventoryOverviewTotals {
  let totalCards = 0
  let totalPurchasePrice = 0
  let totalMarketValue = 0
  for (const row of rows) {
    if (row.liveQuantity > 0) totalCards += 1
    totalPurchasePrice += row.purchasePriceTotal
    totalMarketValue += row.marketValueTotal
  }
  return { totalCards, totalPurchasePrice, totalMarketValue }
}
