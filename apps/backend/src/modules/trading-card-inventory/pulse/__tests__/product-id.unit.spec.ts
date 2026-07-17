import { parseProductId } from "../product-id"

describe("parseProductId", () => {
  it("parses a well-formed six-segment product id", () => {
    const result = parseProductId("card:swsh4pt5|044/072|Holo|null|null|null")
    expect(result.wellFormed).toBe(true)
    expect(result.setCodeCandidate).toBe("swsh4pt5")
    expect(result.cardNumberCandidate).toBe("044/072")
    expect(result.materialCandidate).toBe("Holo")
    expect(result.conditionCandidate).toBeNull()
  })

  it("extracts a trailing condition token from a seven-segment product id", () => {
    const result = parseProductId("card:base3|53/62|null|null|null|null|lp")
    expect(result.wellFormed).toBe(true)
    expect(result.cardNumberCandidate).toBe("53/62")
    expect(result.conditionCandidate).toBe("lp")
  })

  it("preserves an unknown trailing condition for validation diagnostics", () => {
    const result = parseProductId("card:base3|53/62|null|null|null|null|shopworn")
    expect(result.conditionCandidate).toBe("shopworn")
  })

  it("does not trust segment 4 as always null (promo text observed there in real exports)", () => {
    const result = parseProductId("card:wc23cl|139/195|null|Colorless Lugia: Gabriel Fernandez|null|null")
    expect(result.wellFormed).toBe(true)
    expect(result.setCodeCandidate).toBe("wc23cl")
    expect(result.cardNumberCandidate).toBe("139/195")
    // Segment 4 is not treated as a condition or trusted field — it stays opaque.
    expect(result.conditionCandidate).toBeNull()
  })

  it("flags a missing provider prefix as not well-formed", () => {
    const result = parseProductId("swsh4pt5|044/072|Holo|null|null|null")
    expect(result.wellFormed).toBe(false)
    expect(result.providerPrefixPresent).toBe(false)
  })

  it("flags an empty or malformed value as not well-formed", () => {
    expect(parseProductId("").wellFormed).toBe(false)
    expect(parseProductId("card:").wellFormed).toBe(false)
    expect(parseProductId("card:onlyone").wellFormed).toBe(false)
  })

  it("handles non-standard card numbers safely (no strict N/M assumption)", () => {
    expect(parseProductId("card:cbb2_scn|0104/15|PokéBall|null|null|null").cardNumberCandidate).toBe("0104/15")
    expect(parseProductId("card:om_jp|Unnumbered-12|null|null|null|null").cardNumberCandidate).toBe("Unnumbered-12")
  })
})
