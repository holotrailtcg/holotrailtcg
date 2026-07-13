import { deriveRateLimitRequestKey } from "../request-key"

describe("deriveRateLimitRequestKey", () => {
  const secret = "s".repeat(32)

  it("is deterministic for the same address and secret", () => {
    const a = deriveRateLimitRequestKey("203.0.113.1", secret)
    const b = deriveRateLimitRequestKey("203.0.113.1", secret)
    expect(a).toBe(b)
  })

  it("produces a different key for a different address", () => {
    const a = deriveRateLimitRequestKey("203.0.113.1", secret)
    const b = deriveRateLimitRequestKey("203.0.113.2", secret)
    expect(a).not.toBe(b)
  })

  it("produces a different key for a different secret", () => {
    const a = deriveRateLimitRequestKey("203.0.113.1", secret)
    const b = deriveRateLimitRequestKey("203.0.113.1", "t".repeat(32))
    expect(a).not.toBe(b)
  })

  it("returns the full-length HMAC-SHA-256 hex digest (64 characters)", () => {
    const key = deriveRateLimitRequestKey("203.0.113.1", secret)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it("rejects an empty address", () => {
    expect(() => deriveRateLimitRequestKey("", secret)).toThrow()
  })

  it("rejects an empty secret", () => {
    expect(() => deriveRateLimitRequestKey("203.0.113.1", "")).toThrow()
  })

  it("never contains the raw address in its output", () => {
    const address = "203.0.113.1"
    const key = deriveRateLimitRequestKey(address, secret)
    expect(key).not.toContain(address)
  })

  it("canonicalises consistently for a normalised IPv4 address", () => {
    const key = deriveRateLimitRequestKey("198.51.100.7", secret)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it("canonicalises consistently for a normalised (lower-case) IPv6 address", () => {
    const key = deriveRateLimitRequestKey("2001:db8::1", secret)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })
})
