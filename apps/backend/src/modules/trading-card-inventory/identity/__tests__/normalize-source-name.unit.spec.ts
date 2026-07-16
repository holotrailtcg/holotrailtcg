import { normalizeSourceName } from "../normalize-source-name"

describe("normalizeSourceName", () => {
  it("lowercases, trims outer whitespace, and collapses internal whitespace", () => {
    expect(normalizeSourceName("  [ME]  eBay Stock - Holos & Reverse Holos  ")).toBe("[me] ebay stock - holos & reverse holos")
  })

  it("treats differently-cased and differently-spaced names as equivalent", () => {
    expect(normalizeSourceName("[SWSH] eBay Stock")).toBe(normalizeSourceName(" [swsh]   ebay   stock "))
  })

  it("does not collapse or alter meaningfully different names", () => {
    expect(normalizeSourceName("[JP] eBay Stock - Japanese Mixed")).not.toBe(normalizeSourceName("[CH] eBay Stock - Chinese Mixed"))
  })

  it("uses NFC for comparison", () => {
    expect(normalizeSourceName("ébay")).toBe(normalizeSourceName("ébay"))
  })
})
