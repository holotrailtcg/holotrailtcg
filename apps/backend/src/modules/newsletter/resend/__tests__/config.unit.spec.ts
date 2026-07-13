import { resolveResendConfig } from "../config"

const baseEnv = () => ({
  RESEND_API_KEY: "re_test_1234567890",
  RESEND_FROM_EMAIL: "Holo Trail TCG <hello@holotrailtcg.example>",
  RESEND_REPLY_TO_EMAIL: "support@holotrailtcg.example",
  PUBLIC_STOREFRONT_URL: "https://holotrailtcg.example",
})

describe("resolveResendConfig", () => {
  it("resolves a fully valid configuration", () => {
    const config = resolveResendConfig(baseEnv())
    expect(config.apiKey).toBe("re_test_1234567890")
    expect(config.fromEmail).toBe("Holo Trail TCG <hello@holotrailtcg.example>")
    expect(config.replyToEmail).toBe("support@holotrailtcg.example")
    expect(config.storefrontBaseUrl).toBe("https://holotrailtcg.example")
    expect(config.confirmationEmailCooldownSeconds).toBe(300)
    expect(config.confirmationEmailStaleReservationSeconds).toBe(120)
  })

  it("throws when RESEND_API_KEY is missing", () => {
    const env = baseEnv() as Record<string, string | undefined>
    delete env.RESEND_API_KEY
    expect(() => resolveResendConfig(env)).toThrow()
  })

  it("throws when RESEND_API_KEY is empty", () => {
    expect(() => resolveResendConfig({ ...baseEnv(), RESEND_API_KEY: "   " })).toThrow()
  })

  it("accepts a bare RESEND_FROM_EMAIL address", () => {
    const config = resolveResendConfig({ ...baseEnv(), RESEND_FROM_EMAIL: "hello@holotrailtcg.example" })
    expect(config.fromEmail).toBe("hello@holotrailtcg.example")
  })

  it("throws when RESEND_FROM_EMAIL is invalid", () => {
    expect(() => resolveResendConfig({ ...baseEnv(), RESEND_FROM_EMAIL: "not-an-email" })).toThrow()
  })

  it("throws when RESEND_REPLY_TO_EMAIL is invalid", () => {
    expect(() =>
      resolveResendConfig({ ...baseEnv(), RESEND_REPLY_TO_EMAIL: "not-an-email" })
    ).toThrow()
  })

  it("throws when RESEND_REPLY_TO_EMAIL uses the friendly-name format", () => {
    // Reply-to is a bare address only in this design — no display name.
    expect(() =>
      resolveResendConfig({
        ...baseEnv(),
        RESEND_REPLY_TO_EMAIL: "Support <support@holotrailtcg.example>",
      })
    ).toThrow()
  })

  it("accepts a valid HTTPS storefront URL", () => {
    const config = resolveResendConfig({ ...baseEnv(), PUBLIC_STOREFRONT_URL: "https://example.com" })
    expect(config.storefrontBaseUrl).toBe("https://example.com")
  })

  it("normalises a trailing slash on the storefront URL", () => {
    const config = resolveResendConfig({ ...baseEnv(), PUBLIC_STOREFRONT_URL: "https://example.com/" })
    expect(config.storefrontBaseUrl).toBe("https://example.com")
  })

  it("accepts a local HTTP URL outside production", () => {
    const config = resolveResendConfig({
      ...baseEnv(),
      PUBLIC_STOREFRONT_URL: "http://localhost:8000",
      NODE_ENV: "development",
    })
    expect(config.storefrontBaseUrl).toBe("http://localhost:8000")
  })

  it("rejects an HTTP URL in production", () => {
    expect(() =>
      resolveResendConfig({
        ...baseEnv(),
        PUBLIC_STOREFRONT_URL: "http://localhost:8000",
        NODE_ENV: "production",
      })
    ).toThrow()
  })

  it("rejects a non-local HTTP URL outside production", () => {
    expect(() =>
      resolveResendConfig({
        ...baseEnv(),
        PUBLIC_STOREFRONT_URL: "http://holotrailtcg.example",
        NODE_ENV: "development",
      })
    ).toThrow()
  })

  it("rejects an unsafe URL scheme", () => {
    expect(() =>
      resolveResendConfig({ ...baseEnv(), PUBLIC_STOREFRONT_URL: "javascript:alert(1)" })
    ).toThrow()
  })

  it("rejects a malformed URL", () => {
    expect(() => resolveResendConfig({ ...baseEnv(), PUBLIC_STOREFRONT_URL: "not a url" })).toThrow()
  })

  it("rejects a storefront URL with a path", () => {
    expect(() =>
      resolveResendConfig({ ...baseEnv(), PUBLIC_STOREFRONT_URL: "https://example.com/storefront" })
    ).toThrow()
  })

  it("rejects a storefront URL with a query string", () => {
    expect(() =>
      resolveResendConfig({ ...baseEnv(), PUBLIC_STOREFRONT_URL: "https://example.com/?a=1" })
    ).toThrow()
  })

  it("accepts a configured cooldown within bounds", () => {
    const config = resolveResendConfig({
      ...baseEnv(),
      NEWSLETTER_CONFIRMATION_EMAIL_COOLDOWN_SECONDS: "60",
    })
    expect(config.confirmationEmailCooldownSeconds).toBe(60)
  })

  it("rejects a cooldown outside bounds", () => {
    expect(() =>
      resolveResendConfig({
        ...baseEnv(),
        NEWSLETTER_CONFIRMATION_EMAIL_COOLDOWN_SECONDS: "-1",
      })
    ).toThrow()
    expect(() =>
      resolveResendConfig({
        ...baseEnv(),
        NEWSLETTER_CONFIRMATION_EMAIL_COOLDOWN_SECONDS: "999999",
      })
    ).toThrow()
  })

  it("rejects a non-integer cooldown", () => {
    expect(() =>
      resolveResendConfig({
        ...baseEnv(),
        NEWSLETTER_CONFIRMATION_EMAIL_COOLDOWN_SECONDS: "12.5",
      })
    ).toThrow()
  })

  it("accepts a configured stale-reservation window within bounds", () => {
    const config = resolveResendConfig({
      ...baseEnv(),
      NEWSLETTER_CONFIRMATION_EMAIL_STALE_RESERVATION_SECONDS: "60",
    })
    expect(config.confirmationEmailStaleReservationSeconds).toBe(60)
  })

  it("rejects a stale-reservation window outside bounds", () => {
    expect(() =>
      resolveResendConfig({
        ...baseEnv(),
        NEWSLETTER_CONFIRMATION_EMAIL_STALE_RESERVATION_SECONDS: "0",
      })
    ).toThrow()
    expect(() =>
      resolveResendConfig({
        ...baseEnv(),
        NEWSLETTER_CONFIRMATION_EMAIL_STALE_RESERVATION_SECONDS: "999999",
      })
    ).toThrow()
  })

  it("fails closed in production when required configuration is missing", () => {
    const env = baseEnv() as Record<string, string | undefined>
    delete env.RESEND_API_KEY
    env.NODE_ENV = "production"
    expect(() => resolveResendConfig(env)).toThrow()
  })
})
