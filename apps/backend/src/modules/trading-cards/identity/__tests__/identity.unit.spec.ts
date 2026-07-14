import { cardNumberForms } from "../card-number"
import { canonicalIdentityKey } from "../identity-key"
import { normaliseLanguage } from "../normalise-language"

describe("trading-card identity", () => {
  it.each(["044/072", "0104/15", "53/62"])("preserves card number %s", (value) => {
    expect(cardNumberForms(value)).toEqual({ original: value, normalised: value })
  })

  it("preserves the original while trimming only the comparison form", () => {
    expect(cardNumberForms(" 0104/15 ")).toEqual({ original: " 0104/15 ", normalised: "0104/15" })
  })

  it("uses NFC for comparison", () => {
    expect(cardNumberForms("e\u0301").normalised).toBe("é")
  })

  it("keeps leading zeroes in identity keys", () => {
    expect(canonicalIdentityKey("set_1", "0104/15")).not.toBe(canonicalIdentityKey("set_1", "104/15"))
  })

  it.each(["EN", "ja", " ZH "])("accepts a supported language %s", (value) => {
    expect(normaliseLanguage(value)).toBe(value.trim().toUpperCase())
  })

  it("rejects an unsupported language", () => {
    expect(() => normaliseLanguage("FR")).toThrow("Unsupported card language")
  })
})
