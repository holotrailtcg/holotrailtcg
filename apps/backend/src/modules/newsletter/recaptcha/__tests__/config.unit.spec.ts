import { resolveRecaptchaConfig } from "../config"

const validEnv = () => ({
  RECAPTCHA_SECRET_KEY: "test-only-secret-key",
  NEWSLETTER_RECAPTCHA_MIN_SCORE: "0.5",
})

describe("resolveRecaptchaConfig", () => {
  it("accepts a valid secret and score", () => {
    const config = resolveRecaptchaConfig(validEnv())
    expect(config.secretKey).toBe("test-only-secret-key")
    expect(config.minScore).toBe(0.5)
    expect(config.allowedHostnames).toBeNull()
    expect(config.maxTokenAgeSeconds).toBe(120)
  })

  it("accepts a score of exactly zero", () => {
    const config = resolveRecaptchaConfig({
      ...validEnv(),
      NEWSLETTER_RECAPTCHA_MIN_SCORE: "0",
    })
    expect(config.minScore).toBe(0)
  })

  it("accepts a score of exactly one", () => {
    const config = resolveRecaptchaConfig({
      ...validEnv(),
      NEWSLETTER_RECAPTCHA_MIN_SCORE: "1",
    })
    expect(config.minScore).toBe(1)
  })

  it("rejects a score below zero", () => {
    expect(() =>
      resolveRecaptchaConfig({ ...validEnv(), NEWSLETTER_RECAPTCHA_MIN_SCORE: "-0.1" })
    ).toThrow()
  })

  it("rejects a score above one", () => {
    expect(() =>
      resolveRecaptchaConfig({ ...validEnv(), NEWSLETTER_RECAPTCHA_MIN_SCORE: "1.1" })
    ).toThrow()
  })

  it("rejects a malformed score", () => {
    expect(() =>
      resolveRecaptchaConfig({ ...validEnv(), NEWSLETTER_RECAPTCHA_MIN_SCORE: "not-a-number" })
    ).toThrow()
  })

  it("parses a comma-separated allowed-hostnames list", () => {
    const config = resolveRecaptchaConfig({
      ...validEnv(),
      NEWSLETTER_RECAPTCHA_ALLOWED_HOSTNAMES: "holotrailtcg.com, www.holotrailtcg.com",
    })
    expect(config.allowedHostnames).toEqual(["holotrailtcg.com", "www.holotrailtcg.com"])
  })

  it("rejects an invalid hostname entry", () => {
    expect(() =>
      resolveRecaptchaConfig({
        ...validEnv(),
        NEWSLETTER_RECAPTCHA_ALLOWED_HOSTNAMES: "not a hostname!",
      })
    ).toThrow()
  })

  it("parses a valid custom max token age", () => {
    const config = resolveRecaptchaConfig({
      ...validEnv(),
      NEWSLETTER_RECAPTCHA_MAX_TOKEN_AGE_SECONDS: "90",
    })
    expect(config.maxTokenAgeSeconds).toBe(90)
  })

  it("throws in production-equivalent usage when the secret is missing", () => {
    const env = validEnv()
    delete (env as Record<string, string | undefined>).RECAPTCHA_SECRET_KEY
    expect(() => resolveRecaptchaConfig(env)).toThrow()
  })

  it("fails closed: an empty environment throws rather than falling back to defaults", () => {
    expect(() => resolveRecaptchaConfig({})).toThrow()
  })
})
