import { parsePulseRow, type PulseCsvRecord } from "../row-parser"
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

  it("keeps raw fields bounded and never stores the full raw row", () => {
    const row = parsePulseRow(baseRecord(), 2, INVENTORY_SOURCE_LANGUAGE.EN)
    expect(Object.keys(row.rawFields).sort()).toEqual(
      ["cardNumber", "gradedBy", "grade", "itemType", "material", "productName", "promoInfo", "setName"].sort(),
    )
    expect(JSON.stringify(row.rawFields).length).toBeLessThan(4000)
  })
})
