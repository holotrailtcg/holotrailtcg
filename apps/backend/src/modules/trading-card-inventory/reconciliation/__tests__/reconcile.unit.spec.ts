import { canonicalDecimal, weightedAverage } from "../decimal"
import { aggregateSnapshotEntries, groupKey, reconcileSnapshots, type SnapshotEntryInput } from "../reconcile"

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
    ]).get("variant:tcvar_1|sep=0|split=")!
    expect(grouped.quantity).toBe(4)
    expect(grouped.unitAcquisitionCost).toBe("1.75")
    expect(grouped.duplicateRowCount).toBe(2)
  })

  it("marks a missing variant match as unresolved", () => {
    expect(aggregateSnapshotEntries([row({ tradingCardVariantId: null })]).values().next().value.unresolvedReason).toMatch(/No approved/)
  })

  it("never groups rows solely because they share a raw Pulse Product ID — a resolved variant is the real identity", () => {
    // Same raw provider reference, but two different resolved variants (e.g. explicit CSV
    // Condition differed row-to-row): must become two separate, independently-resolved
    // groups, never one merged "unresolved" bucket with summed quantity across identities.
    const grouped = aggregateSnapshotEntries([row({ tradingCardVariantId: "tcvar_1" }), row({ tradingCardVariantId: "tcvar_2" })])
    expect(grouped.size).toBe(2)
    expect(grouped.get("variant:tcvar_1|sep=0|split=")!.quantity).toBe(1)
    expect(grouped.get("variant:tcvar_2|sep=0|split=")!.quantity).toBe(1)
    expect([...grouped.values()].every((entry) => entry.unresolvedReason === null)).toBe(true)
  })

  it("keeps rows with different conditions/finishes/treatments apart before a variant is resolved", () => {
    const unmatched = (overrides: Partial<SnapshotEntryInput> = {}) =>
      row({ tradingCardVariantId: null, conditionCandidate: "NEAR_MINT", finishCandidate: "NORMAL", specialTreatmentCandidate: "NONE", ...overrides })
    const grouped = aggregateSnapshotEntries([
      unmatched(),
      unmatched({ conditionCandidate: "LIGHTLY_PLAYED" }),
      unmatched({ finishCandidate: "HOLO" }),
      unmatched({ specialTreatmentCandidate: "COSMOS_HOLO" }),
    ])
    expect(grouped.size).toBe(4)
  })

  it("never merges rows with different language, or different requires-separate-listing intent, even under the same resolved variant", () => {
    const grouped = aggregateSnapshotEntries([
      row({ tradingCardVariantId: "tcvar_1", requiresSeparateListing: false }),
      row({ tradingCardVariantId: "tcvar_1", requiresSeparateListing: true }),
    ])
    expect(grouped.size).toBe(2)
    expect(grouped.get("variant:tcvar_1|sep=0|split=")!.quantity).toBe(1)
    expect(grouped.get("variant:tcvar_1|sep=1|split=")!.quantity).toBe(1)
  })

  it("aggregates a large duplicate group without losing rows", () => {
    const entries = Array.from({ length: 10_000 }, () => row())
    const grouped = aggregateSnapshotEntries(entries).get("variant:tcvar_1|sep=0|split=")!
    expect(grouped.quantity).toBe(10_000)
    expect(grouped.duplicateRowCount).toBe(10_000)
  })

  it("splits a reviewer-tagged subset into its own group via splitGroupKey, never merging split and unsplit rows", () => {
    const grouped = aggregateSnapshotEntries([
      row({ splitGroupKey: null }),
      row({ splitGroupKey: null }),
      row({ splitGroupKey: "abc123" }),
    ])
    expect(grouped.size).toBe(2)
    expect(grouped.get("variant:tcvar_1|sep=0|split=")!.quantity).toBe(2)
    expect(grouped.get("variant:tcvar_1|sep=0|split=abc123")!.quantity).toBe(1)
  })

  it("keeps rows tagged with different split tokens apart from each other too", () => {
    const grouped = aggregateSnapshotEntries([row({ splitGroupKey: "token-a" }), row({ splitGroupKey: "token-b" })])
    expect(grouped.size).toBe(2)
  })
})

describe("groupKey (exported for split-workflow reuse)", () => {
  it("computes the identical key aggregateSnapshotEntries would bucket the same entry under", () => {
    const entry = row({ splitGroupKey: "tok" })
    expect(groupKey(entry)).toBe("variant:tcvar_1|sep=0|split=tok")
    expect([...aggregateSnapshotEntries([entry]).keys()]).toEqual([groupKey(entry)])
  })
})

describe("snapshot comparison", () => {
  it("creates new, quantity, cost, price, no-change, unresolved, and missing-to-zero proposals", () => {
    // Each scenario is modelled as a genuinely distinct saleable identity (its own
    // resolved variant) — reconciliation groups by identity, not raw provider reference,
    // so scenarios sharing one variant would incorrectly merge into a single proposal.
    const previous = [
      row({ providerReference: "missing", tradingCardVariantId: "tcvar_missing", quantity: 4 }),
      row({ providerReference: "quantity", tradingCardVariantId: "tcvar_quantity", quantity: 1 }),
      row({ providerReference: "cost", tradingCardVariantId: "tcvar_cost", unitAcquisitionCost: "1" }),
      row({ providerReference: "price", tradingCardVariantId: "tcvar_price", unitSellingPrice: "3" }),
      row({ providerReference: "same", tradingCardVariantId: "tcvar_same" }),
    ]
    const current = [
      row({ providerReference: "new", tradingCardVariantId: "tcvar_new" }),
      row({ providerReference: "quantity", tradingCardVariantId: "tcvar_quantity", quantity: 2 }),
      row({ providerReference: "cost", tradingCardVariantId: "tcvar_cost", unitAcquisitionCost: "1.5" }),
      row({ providerReference: "price", tradingCardVariantId: "tcvar_price", unitSellingPrice: "4" }),
      row({ providerReference: "same", tradingCardVariantId: "tcvar_same" }),
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
