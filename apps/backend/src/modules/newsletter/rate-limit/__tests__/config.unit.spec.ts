import { resolveRateLimitConfig } from "../config"

const validEnv = () => ({
  NEWSLETTER_RATE_LIMIT_WINDOW_SECONDS: "60",
  NEWSLETTER_RATE_LIMIT_MAX_REQUESTS: "5",
  NEWSLETTER_RATE_LIMIT_HASH_SECRET: "a".repeat(32),
})

describe("resolveRateLimitConfig", () => {
  it("accepts valid values", () => {
    const config = resolveRateLimitConfig(validEnv())
    expect(config).toEqual({
      windowSeconds: 60,
      maxRequests: 5,
      hashSecret: "a".repeat(32),
    })
  })

  it("throws when the hash secret is missing", () => {
    const env = validEnv()
    delete (env as Record<string, string | undefined>).NEWSLETTER_RATE_LIMIT_HASH_SECRET
    expect(() => resolveRateLimitConfig(env)).toThrow()
  })

  it("throws when the hash secret is weaker than the documented minimum", () => {
    expect(() =>
      resolveRateLimitConfig({ ...validEnv(), NEWSLETTER_RATE_LIMIT_HASH_SECRET: "short" })
    ).toThrow()
  })

  it("throws on a zero window", () => {
    expect(() =>
      resolveRateLimitConfig({ ...validEnv(), NEWSLETTER_RATE_LIMIT_WINDOW_SECONDS: "0" })
    ).toThrow()
  })

  it("throws on a negative window", () => {
    expect(() =>
      resolveRateLimitConfig({ ...validEnv(), NEWSLETTER_RATE_LIMIT_WINDOW_SECONDS: "-5" })
    ).toThrow()
  })

  it("throws on a decimal window", () => {
    expect(() =>
      resolveRateLimitConfig({ ...validEnv(), NEWSLETTER_RATE_LIMIT_WINDOW_SECONDS: "5.5" })
    ).toThrow()
  })

  it("throws on a non-numeric window", () => {
    expect(() =>
      resolveRateLimitConfig({ ...validEnv(), NEWSLETTER_RATE_LIMIT_WINDOW_SECONDS: "NaN" })
    ).toThrow()
  })

  it("throws on an excessively large window", () => {
    expect(() =>
      resolveRateLimitConfig({ ...validEnv(), NEWSLETTER_RATE_LIMIT_WINDOW_SECONDS: "999999999" })
    ).toThrow()
  })

  it("throws on a zero maximum", () => {
    expect(() =>
      resolveRateLimitConfig({ ...validEnv(), NEWSLETTER_RATE_LIMIT_MAX_REQUESTS: "0" })
    ).toThrow()
  })

  it("throws on a negative maximum", () => {
    expect(() =>
      resolveRateLimitConfig({ ...validEnv(), NEWSLETTER_RATE_LIMIT_MAX_REQUESTS: "-1" })
    ).toThrow()
  })

  it("throws on a decimal maximum", () => {
    expect(() =>
      resolveRateLimitConfig({ ...validEnv(), NEWSLETTER_RATE_LIMIT_MAX_REQUESTS: "1.5" })
    ).toThrow()
  })

  it("throws on an excessively large maximum", () => {
    expect(() =>
      resolveRateLimitConfig({ ...validEnv(), NEWSLETTER_RATE_LIMIT_MAX_REQUESTS: "999999" })
    ).toThrow()
  })

  it("fails closed: an empty environment throws rather than falling back to defaults", () => {
    expect(() => resolveRateLimitConfig({})).toThrow()
  })
})
