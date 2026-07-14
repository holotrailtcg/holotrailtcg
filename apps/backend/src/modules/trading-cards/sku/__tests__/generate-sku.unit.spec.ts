import { generateSku } from "../generate-sku"

const input = {
  tradingCardId: "tcard_01", game: "POKEMON", language: "ZH", setCode: "cbb2_scn",
  cardNumber: "0104/15", cardName: "Éevee / 伊布", condition: "NEAR_MINT" as const,
  finish: "HOLO" as const, specialTreatment: "POKE_BALL" as const,
}

describe("SKU generation", () => {
  it("is deterministic, uppercase, safe, readable, and preserves leading zeroes", () => {
    const sku = generateSku(input)
    expect(generateSku(input)).toBe(sku)
    expect(sku).toMatch(/^[A-Z0-9_-]+$/)
    expect(sku).toContain("0104_15")
    expect(sku).toContain("EEVEE")
  })

  it("never exceeds 128 characters", () => {
    const sku = generateSku({
      ...input,
      setCode: "Extremely long set code ".repeat(20),
      cardNumber: "Extremely long card number ".repeat(20),
      cardName: "Extremely long name ".repeat(50),
    })
    expect(sku).toHaveLength(128)
    expect(sku).toMatch(/-[0-9A-F]{8}$/)
  })

  it("changes the hash when identity-defining commercial fields change", () => {
    expect(generateSku({ ...input, condition: "LIGHTLY_PLAYED" })).not.toBe(generateSku(input))
    expect(generateSku({ ...input, tradingCardId: "tcard_02" })).not.toBe(generateSku(input))
  })
})
