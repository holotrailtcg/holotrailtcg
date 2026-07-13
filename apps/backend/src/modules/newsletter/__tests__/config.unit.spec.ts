import { resolveConfirmationTokenTtlMinutes } from "../lifecycle/config"

describe("resolveConfirmationTokenTtlMinutes", () => {
  const originalEnv = process.env.NEWSLETTER_CONFIRMATION_TOKEN_TTL_MINUTES

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NEWSLETTER_CONFIRMATION_TOKEN_TTL_MINUTES
    } else {
      process.env.NEWSLETTER_CONFIRMATION_TOKEN_TTL_MINUTES = originalEnv
    }
  })

  it("defaults to 60 minutes when unset", () => {
    delete process.env.NEWSLETTER_CONFIRMATION_TOKEN_TTL_MINUTES
    expect(resolveConfirmationTokenTtlMinutes()).toBe(60)
  })

  it("reads a valid value from the environment", () => {
    process.env.NEWSLETTER_CONFIRMATION_TOKEN_TTL_MINUTES = "30"
    expect(resolveConfirmationTokenTtlMinutes()).toBe(30)
  })

  it("prefers an explicit override over the environment", () => {
    process.env.NEWSLETTER_CONFIRMATION_TOKEN_TTL_MINUTES = "30"
    expect(resolveConfirmationTokenTtlMinutes(5)).toBe(5)
  })

  it("rejects zero", () => {
    expect(() => resolveConfirmationTokenTtlMinutes(0)).toThrow()
  })

  it("rejects a negative value", () => {
    expect(() => resolveConfirmationTokenTtlMinutes(-1)).toThrow()
  })

  it("rejects NaN from a malformed environment value", () => {
    process.env.NEWSLETTER_CONFIRMATION_TOKEN_TTL_MINUTES = "not-a-number"
    expect(() => resolveConfirmationTokenTtlMinutes()).toThrow()
  })

  it("rejects a non-integer value", () => {
    expect(() => resolveConfirmationTokenTtlMinutes(1.5)).toThrow()
  })

  it("rejects an extreme value beyond the safe upper bound", () => {
    expect(() => resolveConfirmationTokenTtlMinutes(1_000_000)).toThrow()
  })
})
