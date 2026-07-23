import { entryRowToMatchInput } from "../pulse-import-shared"

describe("entryRowToMatchInput", () => {
  it("retains the persisted explicit condition on retry rather than reconstructing it from Product ID", () => {
    // Product ID here carries no condition token at all; the original parse
    // resolved condition from the CSV `Condition` column ("LP") and persisted
    // it — retry must read that back, not silently re-default to Near Mint.
    const entryRow = {
      row_number: 3, outcome: "VALID", provider_reference: "card:sv1|066/196|holo|null|null|null",
      quantity: 1, currency_code: "GBP", unit_acquisition_cost: null, unit_market_price: null, unit_selling_price: null,
      condition_candidate: "LIGHTLY_PLAYED", condition_source: "EXPLICIT",
      finish_candidate: "HOLO", special_treatment_candidate: "NONE",
      rarity_candidate: null, rarity_raw: null, language_conflict: false,
    }
    const row = entryRowToMatchInput(entryRow, "EN")
    expect(row.conditionCandidate).toBe("LIGHTLY_PLAYED")
    expect(row.conditionSource).toBe("EXPLICIT")
  })

  it("retains a persisted DEFAULTED Near Mint condition on retry rather than inventing an EXPLICIT source", () => {
    const entryRow = {
      row_number: 4, outcome: "VALID", provider_reference: "card:sv1|066/196|holo|null|null|null",
      quantity: 1, currency_code: "GBP", unit_acquisition_cost: null, unit_market_price: null, unit_selling_price: null,
      condition_candidate: "NEAR_MINT", condition_source: "DEFAULTED",
      finish_candidate: "HOLO", special_treatment_candidate: "NONE",
      rarity_candidate: null, rarity_raw: null, language_conflict: false,
    }
    const row = entryRowToMatchInput(entryRow, "EN")
    expect(row.conditionCandidate).toBe("NEAR_MINT")
    expect(row.conditionSource).toBe("DEFAULTED")
  })
})
