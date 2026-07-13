import { normaliseEmail } from "../lifecycle/email"

describe("normaliseEmail", () => {
  it("trims surrounding whitespace", () => {
    const result = normaliseEmail("  ash@example.com  ")
    expect(result.email).toBe("ash@example.com")
    expect(result.normalisedEmail).toBe("ash@example.com")
  })

  it("lower-cases the normalised key but preserves display casing", () => {
    const result = normaliseEmail("Ash.Ketchum@Example.COM")
    expect(result.email).toBe("Ash.Ketchum@Example.COM")
    expect(result.normalisedEmail).toBe("ash.ketchum@example.com")
  })

  it("preserves plus aliases", () => {
    const result = normaliseEmail("ash+newsletter@example.com")
    expect(result.normalisedEmail).toBe("ash+newsletter@example.com")
  })

  it("preserves dots in the local part", () => {
    const result = normaliseEmail("a.s.h@example.com")
    expect(result.normalisedEmail).toBe("a.s.h@example.com")
  })

  it("does not apply Gmail-specific rewriting", () => {
    // A Gmail-specific normaliser would strip dots and the +alias; this
    // strategy must not, per the Stage 2C.3 brief.
    const dotted = normaliseEmail("a.s.h+promo@gmail.com")
    expect(dotted.normalisedEmail).toBe("a.s.h+promo@gmail.com")
  })

  it("preserves Unicode in the local part", () => {
    const result = normaliseEmail("Ælfric@example.com")
    expect(result.normalisedEmail).toBe("ælfric@example.com")
  })

  it("rejects an empty value", () => {
    expect(() => normaliseEmail("   ")).toThrow()
  })

  it("rejects a non-string value", () => {
    // @ts-expect-error deliberately invalid input
    expect(() => normaliseEmail(undefined)).toThrow()
  })

  it("rejects a value exceeding the maximum length", () => {
    const tooLong = `${"a".repeat(250)}@example.com` // > 254 chars
    expect(() => normaliseEmail(tooLong)).toThrow()
  })

  it("is deterministic for the same input", () => {
    const first = normaliseEmail("Ash@Example.com")
    const second = normaliseEmail("Ash@Example.com")
    expect(first).toEqual(second)
  })
})
