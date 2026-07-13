import { assertConsentInput, cleanFirstName } from "../lifecycle/clean-input"

describe("cleanFirstName", () => {
  it("trims surrounding whitespace", () => {
    expect(cleanFirstName("  Ash  ")).toBe("Ash")
  })

  it("rejects an empty value", () => {
    expect(() => cleanFirstName("   ")).toThrow()
  })

  it("rejects a non-string value", () => {
    // @ts-expect-error deliberately invalid input
    expect(() => cleanFirstName(undefined)).toThrow()
  })

  it("rejects a value exceeding the maximum length", () => {
    expect(() => cleanFirstName("a".repeat(101))).toThrow()
  })

  it("preserves legitimate Unicode", () => {
    expect(cleanFirstName("Zoë")).toBe("Zoë")
  })

  it("does not strip punctuation merely because it is unusual", () => {
    expect(cleanFirstName("O'Brien-Smith")).toBe("O'Brien-Smith")
  })
})

describe("assertConsentInput", () => {
  it("accepts a valid, minimal input and defaults consentedAt", () => {
    const result = assertConsentInput({
      consentTextVersion: "2026-07-13-v1",
      source: "coming-soon",
    })
    expect(result.consentTextVersion).toBe("2026-07-13-v1")
    expect(result.source).toBe("coming-soon")
    expect(result.consentedAt).toBeInstanceOf(Date)
  })

  it("uses a provided consentedAt override for deterministic tests", () => {
    const fixed = new Date("2026-01-01T00:00:00.000Z")
    const result = assertConsentInput({
      consentTextVersion: "v1",
      source: "coming-soon",
      consentedAt: fixed,
    })
    expect(result.consentedAt).toBe(fixed)
  })

  it("rejects an empty consentTextVersion", () => {
    expect(() =>
      assertConsentInput({ consentTextVersion: "  ", source: "coming-soon" })
    ).toThrow()
  })

  it("rejects an empty source", () => {
    expect(() =>
      assertConsentInput({ consentTextVersion: "v1", source: "  " })
    ).toThrow()
  })

  it("rejects a consentTextVersion exceeding the maximum length", () => {
    expect(() =>
      assertConsentInput({
        consentTextVersion: "a".repeat(33),
        source: "coming-soon",
      })
    ).toThrow()
  })

  it("rejects a source exceeding the maximum length", () => {
    expect(() =>
      assertConsentInput({ consentTextVersion: "v1", source: "a".repeat(65) })
    ).toThrow()
  })

  it("rejects an invalid consentedAt", () => {
    expect(() =>
      assertConsentInput({
        consentTextVersion: "v1",
        source: "coming-soon",
        consentedAt: new Date("not-a-date"),
      })
    ).toThrow()
  })
})
