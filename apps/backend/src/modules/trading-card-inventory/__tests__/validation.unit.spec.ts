import {
  createInventorySourceSchema, currencyCodeSchema, inventoryHoldingUpsertSchema, inventoryTransactionAppendSchema, nonNegativeIntSchema,
} from "../validation"

describe("currencyCodeSchema", () => {
  it("accepts a well-formed ISO 4217 code", () => {
    expect(currencyCodeSchema.parse("GBP")).toBe("GBP")
  })

  it.each(["gbp", "GB", "GBPP", "12P", ""])("rejects %s", (value) => {
    expect(() => currencyCodeSchema.parse(value)).toThrow()
  })
})

describe("nonNegativeIntSchema", () => {
  it("accepts zero and positive integers", () => {
    expect(nonNegativeIntSchema.parse(0)).toBe(0)
    expect(nonNegativeIntSchema.parse(5)).toBe(5)
  })

  it.each([-1, 1.5])("rejects %s", (value) => {
    expect(() => nonNegativeIntSchema.parse(value)).toThrow()
  })
})

describe("createInventorySourceSchema", () => {
  const base = {
    displayName: "[SWSH] eBay Stock", provider: "PULSE", language: null,
    defaultCurrencyCode: null, defaultPricingProfileKey: null, defaultStorefrontCategoryId: null, notes: null,
  }

  it("accepts a minimal valid source", () => {
    expect(createInventorySourceSchema.parse(base).displayName).toBe("[SWSH] eBay Stock")
  })

  it("trims the display name", () => {
    expect(createInventorySourceSchema.parse({ ...base, displayName: "  Padded Name  " }).displayName).toBe("Padded Name")
  })

  it("rejects an empty display name", () => {
    expect(() => createInventorySourceSchema.parse({ ...base, displayName: "   " })).toThrow()
  })

  it("rejects an unsupported provider", () => {
    expect(() => createInventorySourceSchema.parse({ ...base, provider: "EBAY" })).toThrow()
  })

  it("rejects notes over 1000 characters", () => {
    expect(() => createInventorySourceSchema.parse({ ...base, notes: "a".repeat(1001) })).toThrow()
  })
})

describe("inventoryHoldingUpsertSchema", () => {
  const base = {
    inventorySourceId: "tcisrc_1", tradingCardVariantId: "tcvar_1", quantity: 5,
    currencyCode: "GBP", unitAcquisitionCost: 1.5, unitMarketPrice: 2, unitSellingPrice: 3, providerReference: "card:me04|056/086",
  }

  it("accepts a fully-populated holding", () => {
    expect(inventoryHoldingUpsertSchema.parse(base).quantity).toBe(5)
  })

  it("rejects a negative quantity", () => {
    expect(() => inventoryHoldingUpsertSchema.parse({ ...base, quantity: -1 })).toThrow()
  })

  it("accepts a null currency and null amounts (unpriced draft)", () => {
    const result = inventoryHoldingUpsertSchema.parse({
      ...base, currencyCode: null, unitAcquisitionCost: null, unitMarketPrice: null, unitSellingPrice: null,
    })
    expect(result.currencyCode).toBeNull()
  })
})

describe("inventoryTransactionAppendSchema", () => {
  it("accepts a valid quantity movement", () => {
    const result = inventoryTransactionAppendSchema.parse({
      tradingCardVariantId: "tcvar_1", inventorySourceId: null, inventoryHoldingId: null, inventorySnapshotId: null,
      quantityBefore: 5, quantityAfter: 3, reason: "WEBSITE_SALE", originatingReference: null, idempotencyKey: null, note: null,
    })
    expect(result.quantityAfter).toBe(3)
  })

  it("rejects an unrecognised reason", () => {
    expect(() => inventoryTransactionAppendSchema.parse({
      tradingCardVariantId: "tcvar_1", quantityBefore: 5, quantityAfter: 3, reason: "STOLEN",
    })).toThrow()
  })
})
