import { matchSnapshotEntry, type TradingCardMatchLookup } from "../matching"
import type { ParsedPulseRow } from "../types"

const baseRow = (overrides: Partial<ParsedPulseRow> = {}): ParsedPulseRow => ({
  rowNumber: 1, outcome: "VALID", providerReference: "card:swsh4pt5|044/072|Holo|null|null|null|nm",
  quantity: 1, currencyCode: "GBP", unitAcquisitionCost: "1.00", unitMarketPrice: "1.06", unitSellingPrice: "0.95",
  conditionSource: "EXPLICIT", conditionCandidate: "NEAR_MINT", conditionUnknownToken: null, finishCandidate: "HOLO", specialTreatmentCandidate: "NONE",
  rarityCandidate: "COMMON", rarityRaw: "Common", languageConflict: false, languageCandidate: "EN",
  cardNumberCandidate: "044/072", setCodeCandidate: "swsh4pt5", gradedCardDetected: false, rawFields: {}, diagnostics: [],
  ...overrides,
})

function lookup(overrides: Partial<TradingCardMatchLookup> = {}): TradingCardMatchLookup {
  return {
    findTrustedPulseReference: async () => null,
    findCandidateVariants: async () => [],
    ...overrides,
  }
}

describe("matchSnapshotEntry", () => {
  it("skips matching for an INVALID or SKIPPED row", async () => {
    const result = await matchSnapshotEntry(baseRow({ outcome: "INVALID" }), lookup())
    expect(result.matchingStatus).toBe("UNMATCHED")
    expect(result.matchedVia).toBe("NONE")
  })

  it("reuses an existing trusted variant-level reference without touching the database again", async () => {
    const result = await matchSnapshotEntry(
      baseRow(),
      lookup({ findTrustedPulseReference: async () => ({ tradingCardId: "tcard_1", tradingCardVariantId: "tcvar_1" }) }),
    )
    expect(result).toMatchObject({ matchingStatus: "MATCHED", tradingCardVariantId: "tcvar_1", matchedVia: "TRUSTED_REFERENCE", shouldPersistTrustedReference: false })
  })

  it("resolves a card-level trusted reference to a unique variant without creating a new reference", async () => {
    const result = await matchSnapshotEntry(
      baseRow(),
      lookup({
        findTrustedPulseReference: async () => ({ tradingCardId: "tcard_1", tradingCardVariantId: null }),
        findCandidateVariants: async () => [{ id: "tcvar_9", tradingCardId: "tcard_1" }],
      }),
    )
    expect(result).toMatchObject({ matchingStatus: "MATCHED", tradingCardVariantId: "tcvar_9", matchedVia: "TRUSTED_REFERENCE", shouldPersistTrustedReference: false })
  })

  it("performs a uniquely-proven case-3 attribute match and allows persisting a new trusted reference", async () => {
    const result = await matchSnapshotEntry(
      baseRow(),
      lookup({ findCandidateVariants: async () => [{ id: "tcvar_5", tradingCardId: "tcard_5" }] }),
    )
    expect(result).toMatchObject({ matchingStatus: "MATCHED", tradingCardVariantId: "tcvar_5", matchedVia: "UNIQUE_ATTRIBUTE_MATCH", shouldPersistTrustedReference: true })
  })

  it("allows a cleanly-absent condition (defaulted to Near Mint) to still be uniquely matched", async () => {
    const result = await matchSnapshotEntry(
      baseRow({ conditionSource: "DEFAULTED", conditionUnknownToken: null }),
      lookup({ findCandidateVariants: async () => [{ id: "tcvar_5", tradingCardId: "tcard_5" }] }),
    )
    expect(result).toMatchObject({ matchingStatus: "MATCHED", tradingCardVariantId: "tcvar_5", matchedVia: "UNIQUE_ATTRIBUTE_MATCH", shouldPersistTrustedReference: true })
  })

  it("never treats a genuinely unrecognized condition token as safe to auto-match, even if a unique candidate would exist", async () => {
    const result = await matchSnapshotEntry(
      baseRow({ conditionSource: "DEFAULTED", conditionUnknownToken: "xyz" }),
      lookup({ findCandidateVariants: async () => [{ id: "tcvar_5", tradingCardId: "tcard_5" }] }),
    )
    expect(result.matchingStatus).toBe("REVIEW_REQUIRED")
    expect(result.shouldPersistTrustedReference).toBe(false)
    expect(result.tradingCardVariantId).toBeNull()
  })

  it("never treats an unrecognised material (missing finish/treatment candidate) as a safe match attempt", async () => {
    const result = await matchSnapshotEntry(
      baseRow({ finishCandidate: null, specialTreatmentCandidate: null }),
      lookup({ findCandidateVariants: async () => [{ id: "tcvar_5", tradingCardId: "tcard_5" }] }),
    )
    expect(result.matchingStatus).toBe("REVIEW_REQUIRED")
  })

  it("never treats a language conflict as a safe match attempt", async () => {
    const result = await matchSnapshotEntry(
      baseRow({ languageConflict: true }),
      lookup({ findCandidateVariants: async () => [{ id: "tcvar_5", tradingCardId: "tcard_5" }] }),
    )
    expect(result.matchingStatus).toBe("REVIEW_REQUIRED")
  })

  it("returns AMBIGUOUS and never picks one when more than one candidate matches", async () => {
    const result = await matchSnapshotEntry(
      baseRow(),
      lookup({ findCandidateVariants: async () => [{ id: "tcvar_5", tradingCardId: "tcard_5" }, { id: "tcvar_6", tradingCardId: "tcard_6" }] }),
    )
    expect(result.matchingStatus).toBe("AMBIGUOUS")
    expect(result.tradingCardVariantId).toBeNull()
    expect(result.shouldPersistTrustedReference).toBe(false)
  })

  it("returns UNMATCHED when nothing matches", async () => {
    const result = await matchSnapshotEntry(baseRow(), lookup())
    expect(result.matchingStatus).toBe("UNMATCHED")
  })
})
