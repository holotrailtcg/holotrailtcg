import { buildConfirmationUrl, isSupportedCountryCode } from "../confirmation-url"

describe("isSupportedCountryCode", () => {
  it("accepts gb", () => {
    expect(isSupportedCountryCode("gb")).toBe(true)
  })

  it("rejects an upper-case code", () => {
    expect(isSupportedCountryCode("GB")).toBe(false)
  })

  it("rejects a non-2-letter code", () => {
    expect(isSupportedCountryCode("gbr")).toBe(false)
    expect(isSupportedCountryCode("g")).toBe(false)
  })

  it("rejects an empty or non-string value", () => {
    expect(isSupportedCountryCode("")).toBe(false)
    expect(isSupportedCountryCode(undefined as unknown as string)).toBe(false)
  })
})

describe("buildConfirmationUrl", () => {
  const token = "abc123_-XYZ"

  it("builds the expected gb route", () => {
    const url = buildConfirmationUrl({
      storefrontBaseUrl: "https://holotrailtcg.example",
      countryCode: "gb",
      confirmationToken: token,
    })
    expect(url).toBe(`https://holotrailtcg.example/gb/newsletter/confirm?token=${token}`)
  })

  it("produces the same result regardless of a trailing slash on the base URL", () => {
    const withSlash = buildConfirmationUrl({
      storefrontBaseUrl: "https://holotrailtcg.example/",
      countryCode: "gb",
      confirmationToken: token,
    })
    const withoutSlash = buildConfirmationUrl({
      storefrontBaseUrl: "https://holotrailtcg.example",
      countryCode: "gb",
      confirmationToken: token,
    })
    expect(withSlash).toBe(withoutSlash)
  })

  it("URL-encodes the confirmation token safely", () => {
    const url = buildConfirmationUrl({
      storefrontBaseUrl: "https://holotrailtcg.example",
      countryCode: "gb",
      confirmationToken: "a token with spaces/and+chars",
    })
    const parsed = new URL(url)
    expect(parsed.searchParams.get("token")).toBe("a token with spaces/and+chars")
  })

  it("never includes an email address, subscriber id, or hash-shaped param", () => {
    const url = buildConfirmationUrl({
      storefrontBaseUrl: "https://holotrailtcg.example",
      countryCode: "gb",
      confirmationToken: token,
    })
    expect(url).not.toMatch(/@/)
    expect(url).not.toMatch(/nlsub/)
    const parsed = new URL(url)
    expect(Array.from(parsed.searchParams.keys())).toEqual(["token"])
  })

  it("rejects an invalid country code", () => {
    expect(() =>
      buildConfirmationUrl({
        storefrontBaseUrl: "https://holotrailtcg.example",
        countryCode: "GBR",
        confirmationToken: token,
      })
    ).toThrow()
  })

  it("rejects an empty confirmation token", () => {
    expect(() =>
      buildConfirmationUrl({
        storefrontBaseUrl: "https://holotrailtcg.example",
        countryCode: "gb",
        confirmationToken: "   ",
      })
    ).toThrow()
  })

  it("rejects an unsafe base URL", () => {
    expect(() =>
      buildConfirmationUrl({
        storefrontBaseUrl: "not-a-url",
        countryCode: "gb",
        confirmationToken: token,
      })
    ).toThrow()
  })
})
