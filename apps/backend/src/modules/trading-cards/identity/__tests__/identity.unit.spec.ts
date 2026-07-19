import { cardNumberForms, normaliseCardNumberComparisonForm } from "../card-number"
import { canonicalIdentityKey } from "../identity-key"
import { normaliseLanguage } from "../normalise-language"

describe("trading-card identity", () => {
  // The denominator carries no identity information beyond what the card's
  // own CardSet already represents, so it is stripped from the comparison
  // form while remaining verbatim (trimmed) in `original` — see card-number.ts.
  it.each([
    ["044/072", "044"],
    ["0104/15", "0104"],
    ["53/62", "53"],
  ])("strips the denominator from the comparison form of %s", (value, normalised) => {
    expect(cardNumberForms(value)).toEqual({ original: value, normalised })
  })

  it("trims incidental whitespace out of both original and the comparison form — no documented audit requirement retains it", () => {
    expect(cardNumberForms(" 0104/15 ")).toEqual({ original: "0104/15", normalised: "0104" })
  })

  it("preserves a valid single-letter suffix", () => {
    expect(cardNumberForms("025a")).toEqual({ original: "025a", normalised: "025A" })
  })

  it("rejects malformed or ambiguous card numbers", () => {
    expect(() => cardNumberForms("é")).toThrow("is not a recognised format")
    expect(() => cardNumberForms("12/34/56")).toThrow("is not a recognised format")
    expect(() => cardNumberForms("1 2")).toThrow("is not a recognised format")
    expect(() => cardNumberForms("025ab")).toThrow("is not a recognised format")
    expect(() => cardNumberForms("025/ab")).toThrow("is not a recognised format")
    expect(() => cardNumberForms("")).toThrow("must not be empty")
  })

  it("keeps leading zeroes in identity keys", () => {
    expect(canonicalIdentityKey("set_1", "0104/15")).not.toBe(canonicalIdentityKey("set_1", "104/15"))
  })

  describe("normaliseCardNumberComparisonForm", () => {
    it("never throws, unlike cardNumberForms, since callers may pass untrusted/unvalidated text", () => {
      expect(() => normaliseCardNumberComparisonForm("not a card number at all !!")).not.toThrow()
    })

    it.each([
      ["044/072", "044"],
      ["025a", "025A"],
      [" 0104/15 ", "0104"],
      ["", ""],
    ])("normalises %s to %s exactly like cardNumberForms's normalised form would", (value, expected) => {
      expect(normaliseCardNumberComparisonForm(value)).toBe(expected)
    })

    it("agrees with cardNumberForms on every well-formed input", () => {
      for (const value of ["001", "0104/15", "066/196", "025a", "SWSH123", "1/1"]) {
        expect(normaliseCardNumberComparisonForm(value)).toBe(cardNumberForms(value).normalised)
      }
    })
  })

  it.each(["EN", "ja", " ZH "])("accepts a supported language %s", (value) => {
    expect(normaliseLanguage(value)).toBe(value.trim().toUpperCase())
  })

  it("rejects an unsupported language", () => {
    expect(() => normaliseLanguage("FR")).toThrow("Unsupported card language")
  })
})
