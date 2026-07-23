import { buildPulseCsvRecord, columnCountMismatchRow, parsePulseRow, type PulseCsvRecord } from "../row-parser"
import { INVENTORY_SOURCE_LANGUAGE } from "../../types"

const baseRecord = (overrides: Partial<PulseCsvRecord> = {}): PulseCsvRecord => ({
  "Product Name": "Crobat V", "Set": "Shining Fates", "Card Number": "044/072", "Material": "Holo",
  "Promo Info": "", "Rarity": "Holo Rare V", "Graded By": "", "Grade": "", "Item Type": "Card",
  "Product ID": "card:swsh4pt5|044/072|Holo|null|null|null", "Quantity": "1", "Avg Cost": "£1.00",
  "Market Price": "£1.06", "Sticker Price": "£0.95", "Total Cost": "£1.00", "Total Market Value": "£1.06",
  "Total Sticker Value": "£0.95", "Profit": "£-0.05", "Margin %": "-5.26%", "Markup vs Market %": "-10.38%",
  ...overrides,
})

describe("parsePulseRow", () => {
  it("classifies a clean, fully-recognised row as VALID_WITH_WARNINGS when material/rarity aren't safely mapped, or REVIEW_REQUIRED otherwise", () => {
    // Rarity "Holo Rare V" has no safe mapping, so this real sample row is REVIEW_REQUIRED, not VALID.
    const row = parsePulseRow(baseRecord(), 2, INVENTORY_SOURCE_LANGUAGE.EN)
    expect(row.outcome).toBe("REVIEW_REQUIRED")
    expect(row.quantity).toBe(1)
    expect(row.unitAcquisitionCost).toBe("1.00")
    expect(row.rarityCandidate).toBeNull()
    expect(row.rarityRaw).toBe("Holo Rare V")
  })

  it("classifies a fully clean row (recognised material, mapped rarity, explicit condition) as VALID", () => {
    const row = parsePulseRow(baseRecord({ Rarity: "Common", "Product ID": "card:swsh4pt5|044/072|Holo|null|null|null|nm" }), 2, INVENTORY_SOURCE_LANGUAGE.EN)
    expect(row.outcome).toBe("VALID")
    expect(row.conditionSource).toBe("EXPLICIT")
  })

  it("skips a fully blank row without raising a fatal error", () => {
    const blank: PulseCsvRecord = Object.fromEntries(Object.keys(baseRecord()).map((key) => [key, ""]))
    const row = parsePulseRow(blank, 5, INVENTORY_SOURCE_LANGUAGE.EN)
    expect(row.outcome).toBe("SKIPPED")
    expect(row.diagnostics[0].code).toBe("BLANK_ROW")
  })

  it("marks an invalid quantity as INVALID and does not let it participate further", () => {
    const row = parsePulseRow(baseRecord({ Quantity: "1.5" }), 3, INVENTORY_SOURCE_LANGUAGE.EN)
    expect(row.outcome).toBe("INVALID")
    expect(row.diagnostics.some((diagnostic) => diagnostic.code === "INVALID_QUANTITY")).toBe(true)
  })

  it("marks an invalid money field as INVALID", () => {
    const row = parsePulseRow(baseRecord({ "Avg Cost": "N/A" }), 3, INVENTORY_SOURCE_LANGUAGE.EN)
    expect(row.outcome).toBe("INVALID")
    expect(row.diagnostics.some((diagnostic) => diagnostic.code === "INVALID_MONEY")).toBe(true)
  })

  it("flags a malformed Product ID as INVALID", () => {
    const row = parsePulseRow(baseRecord({ "Product ID": "not-a-product-id" }), 3, INVENTORY_SOURCE_LANGUAGE.EN)
    expect(row.outcome).toBe("INVALID")
    expect(row.diagnostics.some((diagnostic) => diagnostic.code === "MALFORMED_PRODUCT_ID")).toBe(true)
  })

  it("flags a conflicting language hint as REVIEW_REQUIRED without silently overriding the source language", () => {
    const row = parsePulseRow(baseRecord({ "Product ID": "card:s8b_jp|083/184|Holo|null|null|null" }), 4, INVENTORY_SOURCE_LANGUAGE.EN)
    expect(row.languageCandidate).toBe(INVENTORY_SOURCE_LANGUAGE.EN)
    expect(row.languageConflict).toBe(true)
    expect(row.outcome).toBe("REVIEW_REQUIRED")
  })

  it("flags a populated graded-card field as REVIEW_REQUIRED (Stage 3 has no graded-card model yet)", () => {
    const row = parsePulseRow(baseRecord({ "Graded By": "PSA", Grade: "10" }), 6, INVENTORY_SOURCE_LANGUAGE.EN)
    expect(row.gradedCardDetected).toBe(true)
    expect(row.outcome).toBe("REVIEW_REQUIRED")
  })

  it("rejects an oversized field", () => {
    const row = parsePulseRow(baseRecord({ "Promo Info": "x".repeat(2001) }), 7, INVENTORY_SOURCE_LANGUAGE.EN)
    expect(row.diagnostics.some((diagnostic) => diagnostic.code === "OVERSIZED_FIELD")).toBe(true)
  })

  it("prefers the explicit Condition column over the Product ID token when both are present", () => {
    const row = parsePulseRow(
      baseRecord({ Rarity: "Common", Condition: "LP", "Product ID": "card:swsh4pt5|044/072|Holo|null|null|null|nm" }),
      2,
      INVENTORY_SOURCE_LANGUAGE.EN,
    )
    expect(row.conditionCandidate).toBe("LIGHTLY_PLAYED")
    expect(row.conditionSource).toBe("EXPLICIT")
  })

  it("falls back to the Product ID token when the Condition column is absent", () => {
    const row = parsePulseRow(
      baseRecord({ Rarity: "Common", "Product ID": "card:swsh4pt5|044/072|Holo|null|null|null|hp" }),
      2,
      INVENTORY_SOURCE_LANGUAGE.EN,
    )
    expect(row.conditionCandidate).toBe("HEAVILY_PLAYED")
    expect(row.conditionSource).toBe("EXPLICIT")
  })

  it("treats blank material as clean Normal/None and does not force review", () => {
    const row = parsePulseRow(baseRecord({ Material: "", Rarity: "Common", Condition: "NM" }), 2, INVENTORY_SOURCE_LANGUAGE.EN)
    expect(row.outcome).toBe("VALID")
    expect(row.finishCandidate).toBe("NORMAL")
    expect(row.specialTreatmentCandidate).toBe("NONE")
  })

  it("maps Cosmos Holo and Tinsel Holo material values", () => {
    const cosmos = parsePulseRow(baseRecord({ Material: "Cosmos Holo", Rarity: "Common", Condition: "NM" }), 2, INVENTORY_SOURCE_LANGUAGE.EN)
    expect(cosmos.finishCandidate).toBe("HOLO")
    expect(cosmos.specialTreatmentCandidate).toBe("COSMOS_HOLO")

    const tinsel = parsePulseRow(baseRecord({ Material: "Tinsel Holo", Rarity: "Common", Condition: "NM" }), 2, INVENTORY_SOURCE_LANGUAGE.EN)
    expect(tinsel.finishCandidate).toBe("HOLO")
    expect(tinsel.specialTreatmentCandidate).toBe("TINSEL_HOLO")
  })

  it("treats an unsupported explicit Condition value as a clear INVALID review error, never silently defaulted", () => {
    const row = parsePulseRow(baseRecord({ Rarity: "Common", Condition: "GEM MINT 10" }), 2, INVENTORY_SOURCE_LANGUAGE.EN)
    expect(row.outcome).toBe("INVALID")
    const diagnostic = row.diagnostics.find((d) => d.code === "UNKNOWN_CONDITION_TOKEN")
    expect(diagnostic?.severity).toBe("ERROR")
    expect(diagnostic?.rowNumber).toBe(2)
  })

  it("defaults a genuinely blank condition (no CSV value, no Product ID token) to Near Mint without a diagnostic", () => {
    const row = parsePulseRow(baseRecord({ Rarity: "Common" }), 2, INVENTORY_SOURCE_LANGUAGE.EN)
    expect(row.conditionCandidate).toBe("NEAR_MINT")
    expect(row.conditionSource).toBe("DEFAULTED")
    expect(row.diagnostics.some((d) => d.code === "UNKNOWN_CONDITION_TOKEN")).toBe(false)
  })

  it("keeps raw fields bounded and never stores the full raw row", () => {
    const row = parsePulseRow(baseRecord(), 2, INVENTORY_SOURCE_LANGUAGE.EN)
    expect(Object.keys(row.rawFields).sort()).toEqual(
      ["cardNumber", "gradedBy", "grade", "itemType", "material", "productName", "promoInfo", "setName"].sort(),
    )
    expect(JSON.stringify(row.rawFields).length).toBeLessThan(4000)
  })
})

describe("buildPulseCsvRecord / columnCountMismatchRow", () => {
  const headers = ["Product Name", "Set", "Card Number"]

  it("builds a record when the cell count matches the header count", () => {
    const record = buildPulseCsvRecord(headers, ["Crobat V", "Shining Fates", "044/072"])
    expect(record).toEqual({ "Product Name": "Crobat V", "Set": "Shining Fates", "Card Number": "044/072" })
  })

  it("rejects a row with too few columns", () => {
    expect(buildPulseCsvRecord(headers, ["Crobat V", "Shining Fates"])).toBeNull()
  })

  it("rejects a row with too many columns", () => {
    expect(buildPulseCsvRecord(headers, ["Crobat V", "Shining Fates", "044/072", "extra"])).toBeNull()
  })

  it("produces a clear, line-numbered INVALID row for a column-count mismatch", () => {
    const row = columnCountMismatchRow(42, 3, 2, "EN")
    expect(row.outcome).toBe("INVALID")
    expect(row.rowNumber).toBe(42)
    expect(row.diagnostics).toHaveLength(1)
    expect(row.diagnostics[0].code).toBe("COLUMN_COUNT_MISMATCH")
    expect(row.diagnostics[0].severity).toBe("ERROR")
    expect(row.diagnostics[0].rowNumber).toBe(42)
    expect(row.diagnostics[0].message).toMatch(/2 columns.*header.*3/)
  })
})
