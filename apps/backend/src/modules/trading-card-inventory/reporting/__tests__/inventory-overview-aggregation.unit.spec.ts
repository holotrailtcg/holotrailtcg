import { aggregateVariantPricing, summariseInventoryOverviewTotals } from "../inventory-overview-aggregation"

describe("aggregateVariantPricing", () => {
  it("computes a quantity-weighted average acquisition cost across holdings, skipping null-cost holdings in both numerator and denominator", () => {
    const result = aggregateVariantPricing(
      [
        { quantity: 3, unitAcquisitionCost: "2.00", unitMarketPrice: null, sourceObservedAt: null },
        { quantity: 1, unitAcquisitionCost: "6.00", unitMarketPrice: null, sourceObservedAt: null },
        { quantity: 10, unitAcquisitionCost: null, unitMarketPrice: null, sourceObservedAt: null },
      ],
      5,
    )
    // (3*2 + 1*6) / (3+1) = 12/4 = 3.00 — the quantity=10/null-cost holding must not shift this.
    expect(result.avgUnitAcquisitionCost).toBeCloseTo(3.0)
    expect(result.purchasePriceTotal).toBeCloseTo(15.0) // liveQuantity(5) * 3.00
  })

  it("picks unitMarketPrice from the holding with the most recent sourceObservedAt, skipping null-price holdings", () => {
    const result = aggregateVariantPricing(
      [
        { quantity: 1, unitAcquisitionCost: null, unitMarketPrice: "1.50", sourceObservedAt: "2026-01-01T00:00:00Z" },
        { quantity: 1, unitAcquisitionCost: null, unitMarketPrice: null, sourceObservedAt: "2026-06-01T00:00:00Z" },
        { quantity: 1, unitAcquisitionCost: null, unitMarketPrice: "4.20", sourceObservedAt: "2026-03-15T00:00:00Z" },
      ],
      2,
    )
    expect(result.currentUnitMarketPrice).toBeCloseTo(4.2)
    expect(result.marketValueTotal).toBeCloseTo(8.4) // liveQuantity(2) * 4.20
  })

  it("uses live Medusa stock quantity for row math, never a holding's own quantity field", () => {
    const result = aggregateVariantPricing(
      [{ quantity: 999, unitAcquisitionCost: "1.00", unitMarketPrice: "2.00", sourceObservedAt: "2026-01-01T00:00:00Z" }],
      7,
    )
    expect(result.liveQuantity).toBe(7)
    expect(result.purchasePriceTotal).toBeCloseTo(7)
    expect(result.marketValueTotal).toBeCloseTo(14)
  })

  it("computes profit and loss as market value minus purchase price, including negative values", () => {
    const result = aggregateVariantPricing(
      [{ quantity: 1, unitAcquisitionCost: "10.00", unitMarketPrice: "3.00", sourceObservedAt: "2026-01-01T00:00:00Z" }],
      4,
    )
    expect(result.purchasePriceTotal).toBeCloseTo(40)
    expect(result.marketValueTotal).toBeCloseTo(12)
    expect(result.profitAndLoss).toBeCloseTo(-28)
  })

  it("returns nulls and zero totals when there are no holdings at all", () => {
    const result = aggregateVariantPricing([], 3)
    expect(result.avgUnitAcquisitionCost).toBeNull()
    expect(result.currentUnitMarketPrice).toBeNull()
    expect(result.purchasePriceTotal).toBe(0)
    expect(result.marketValueTotal).toBe(0)
    expect(result.profitAndLoss).toBe(0)
  })
})

describe("summariseInventoryOverviewTotals", () => {
  it("sums purchase price and market value across all rows, and counts only rows with live stock towards totalCards", () => {
    const totals = summariseInventoryOverviewTotals([
      { liveQuantity: 5, purchasePriceTotal: 10, marketValueTotal: 15 },
      { liveQuantity: 0, purchasePriceTotal: 0, marketValueTotal: 0 },
      { liveQuantity: 2, purchasePriceTotal: 4, marketValueTotal: 3 },
    ])
    expect(totals.totalCards).toBe(2)
    expect(totals.totalPurchasePrice).toBe(14)
    expect(totals.totalMarketValue).toBe(18)
  })
})
