import { canonicalDecimal, weightedAverage } from "../decimal"
import { aggregateSnapshotEntries, reconcileSnapshots, type SnapshotEntryInput } from "../reconcile"

const row = (overrides: Partial<SnapshotEntryInput> = {}): SnapshotEntryInput => ({
  providerReference: "product-1", providerReferenceType: "PULSE_PRODUCT_ID", tradingCardVariantId: "tcvar_1",
  quantity: 1, currencyCode: "GBP", unitAcquisitionCost: "1.00", unitMarketPrice: "2.00",
  unitSellingPrice: "3.00", ...overrides,
})

describe("exact decimal reconciliation arithmetic", () => {
  it("canonicalises decimal strings and never uses floating point", () => {
    expect(canonicalDecimal("001.2300")).toBe("1.23")
    expect(weightedAverage([{ unitCost: "1.00", quantity: 1 }, { unitCost: "2.00", quantity: 2 }])).toBe("1.666667")
    expect(weightedAverage([{ unitCost: "0", quantity: 4 }])).toBe("0")
  })
})

describe("snapshot aggregation", () => {
  it("groups duplicate provider IDs, sums quantity, and calculates weighted acquisition cost", () => {
    const grouped = aggregateSnapshotEntries([
      row({ quantity: 1, unitAcquisitionCost: "1.00" }), row({ quantity: 3, unitAcquisitionCost: "2.00" }),
    ]).get("PULSE_PRODUCT_ID:product-1")!
    expect(grouped.quantity).toBe(4)
    expect(grouped.unitAcquisitionCost).toBe("1.75")
    expect(grouped.duplicateRowCount).toBe(2)
  })

  it("turns missing and conflicting variant matches into unresolved groups", () => {
    expect(aggregateSnapshotEntries([row({ tradingCardVariantId: null })]).values().next().value.unresolvedReason).toMatch(/No approved/)
    expect(aggregateSnapshotEntries([row(), row({ tradingCardVariantId: "tcvar_2" })]).values().next().value.tradingCardVariantId).toBeNull()
  })

  it("aggregates a large duplicate group without losing rows", () => {
    const entries = Array.from({ length: 10_000 }, () => row())
    const grouped = aggregateSnapshotEntries(entries).get("PULSE_PRODUCT_ID:product-1")!
    expect(grouped.quantity).toBe(10_000)
    expect(grouped.duplicateRowCount).toBe(10_000)
  })
})

describe("snapshot comparison", () => {
  it("creates new, quantity, cost, price, no-change, unresolved, and missing-to-zero proposals", () => {
    const previous = [
      row({ providerReference: "missing", quantity: 4 }),
      row({ providerReference: "quantity", quantity: 1 }),
      row({ providerReference: "cost", unitAcquisitionCost: "1" }),
      row({ providerReference: "price", unitSellingPrice: "3" }),
      row({ providerReference: "same" }),
    ]
    const current = [
      row({ providerReference: "new" }),
      row({ providerReference: "quantity", quantity: 2 }),
      row({ providerReference: "cost", unitAcquisitionCost: "1.5" }),
      row({ providerReference: "price", unitSellingPrice: "4" }),
      row({ providerReference: "same" }),
      row({ providerReference: "unresolved", tradingCardVariantId: null }),
    ]
    const result = reconcileSnapshots({ previous, current })
    const byReference = Object.fromEntries(result.map((proposal) => [proposal.providerReference, proposal]))
    expect(byReference.new.changeKind).toBe("NEW_HOLDING")
    expect(byReference.quantity.changeKind).toBe("QUANTITY_CHANGE")
    expect(byReference.cost.changeKind).toBe("COST_CHANGE")
    expect(byReference.price.changeKind).toBe("PRICE_CHANGE")
    expect(byReference.same.changeKind).toBe("NO_CHANGE")
    expect(byReference.unresolved.changeKind).toBe("UNRESOLVED_VARIANT")
    expect(byReference.missing).toMatchObject({ changeKind: "QUANTITY_CHANGE", previousQuantity: 4, proposedQuantity: 0, quantityDelta: -4 })
  })

  it("uses deterministic precedence for a single minimal proposal and records every changed field", () => {
    const [proposal] = reconcileSnapshots({ previous: [row()], current: [row({ quantity: 2, unitAcquisitionCost: "2", unitSellingPrice: "4" })] })
    expect(proposal.changeKind).toBe("QUANTITY_CHANGE")
    expect(proposal.changedFields).toEqual(["quantity", "acquisition_cost", "selling_price"])
  })

  it("records a locked selling-price suggestion without applying it", () => {
    const [proposal] = reconcileSnapshots({
      previous: [row()], current: [row({ unitSellingPrice: "4" })], priceLockedVariantIds: new Set(["tcvar_1"]),
    })
    expect(proposal).toMatchObject({ changeKind: "PRICE_CHANGE", sellingPriceLocked: true })
    expect(proposal.reason).toMatch(/lock remains authoritative/)
  })

  it("keeps a missing formerly-unresolved row reviewable while proposing quantity zero", () => {
    const [proposal] = reconcileSnapshots({ previous: [row({ tradingCardVariantId: null, quantity: 3 })], current: [] })
    expect(proposal).toMatchObject({
      changeKind: "UNRESOLVED_VARIANT", tradingCardVariantId: null,
      previousQuantity: 3, proposedQuantity: 0, quantityDelta: -3,
    })
  })

  it("is deterministic for the same pair regardless of row order", () => {
    const current = [row({ providerReference: "b" }), row({ providerReference: "a" })]
    expect(reconcileSnapshots({ previous: [], current })).toEqual(reconcileSnapshots({ previous: [], current: [...current].reverse() }))
  })
})
