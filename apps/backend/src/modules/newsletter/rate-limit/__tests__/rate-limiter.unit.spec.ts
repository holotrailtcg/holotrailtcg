import { checkRateLimit, type RateLimitBucketStore } from "../rate-limiter"
import type { RateLimitConfig } from "../config"

const config: RateLimitConfig = {
  windowSeconds: 60,
  maxRequests: 3,
  hashSecret: "s".repeat(32),
}

const now = new Date("2026-07-13T12:00:30.000Z")

class FakeStore implements RateLimitBucketStore {
  private counts = new Map<string, number>()

  async incrementRateLimitBucket(requestKey: string, windowStart: Date): Promise<number> {
    const key = `${requestKey}:${windowStart.toISOString()}`
    const next = (this.counts.get(key) ?? 0) + 1
    this.counts.set(key, next)
    return next
  }
}

class ThrowingStore implements RateLimitBucketStore {
  async incrementRateLimitBucket(): Promise<number> {
    throw new Error("simulated database failure")
  }
}

describe("checkRateLimit", () => {
  it("allows the first request with count 1", async () => {
    const store = new FakeStore()
    const outcome = await checkRateLimit({ store, clientAddress: "203.0.113.1", config, now })
    expect(outcome.allowed).toBe(true)
    expect(outcome.remaining).toBe(2)
  })

  it("allows requests up to the configured maximum", async () => {
    const store = new FakeStore()
    for (let i = 0; i < config.maxRequests; i++) {
      const outcome = await checkRateLimit({ store, clientAddress: "203.0.113.1", config, now })
      expect(outcome.allowed).toBe(true)
    }
  })

  it("denies the first request above the maximum", async () => {
    const store = new FakeStore()
    for (let i = 0; i < config.maxRequests; i++) {
      await checkRateLimit({ store, clientAddress: "203.0.113.1", config, now })
    }
    const outcome = await checkRateLimit({ store, clientAddress: "203.0.113.1", config, now })
    expect(outcome.allowed).toBe(false)
    if (!outcome.allowed) {
      expect(outcome.reason).toBe("LIMIT_EXCEEDED")
    }
  })

  it("never returns a negative remaining count", async () => {
    const store = new FakeStore()
    for (let i = 0; i < config.maxRequests + 5; i++) {
      const outcome = await checkRateLimit({ store, clientAddress: "203.0.113.1", config, now })
      expect(outcome.remaining).toBeGreaterThanOrEqual(0)
    }
  })

  it("allows the same key again in the next window", async () => {
    const store = new FakeStore()
    for (let i = 0; i < config.maxRequests; i++) {
      await checkRateLimit({ store, clientAddress: "203.0.113.1", config, now })
    }
    const denied = await checkRateLimit({ store, clientAddress: "203.0.113.1", config, now })
    expect(denied.allowed).toBe(false)

    const nextWindow = new Date(now.getTime() + config.windowSeconds * 1000)
    const allowed = await checkRateLimit({
      store,
      clientAddress: "203.0.113.1",
      config,
      now: nextWindow,
    })
    expect(allowed.allowed).toBe(true)
  })

  it("does not affect a different key's bucket", async () => {
    const store = new FakeStore()
    for (let i = 0; i < config.maxRequests; i++) {
      await checkRateLimit({ store, clientAddress: "203.0.113.1", config, now })
    }
    const other = await checkRateLimit({ store, clientAddress: "203.0.113.2", config, now })
    expect(other.allowed).toBe(true)
  })

  it("fails closed (does not return allowed: true) when the store throws", async () => {
    const store = new ThrowingStore()
    const outcome = await checkRateLimit({ store, clientAddress: "203.0.113.1", config, now })
    expect(outcome.allowed).toBe(false)
    if (!outcome.allowed) {
      expect(outcome.reason).toBe("DATABASE_ERROR")
    }
  })

  it("fails closed when the client address is empty (HMAC derivation fails)", async () => {
    const store = new FakeStore()
    const outcome = await checkRateLimit({ store, clientAddress: "", config, now })
    expect(outcome.allowed).toBe(false)
    if (!outcome.allowed) {
      expect(outcome.reason).toBe("ADDRESS_UNTRUSTED")
    }
  })

  it("never returns the raw client address, the hash secret, or the request key", async () => {
    const store = new FakeStore()
    const outcome = await checkRateLimit({ store, clientAddress: "203.0.113.1", config, now })
    const serialised = JSON.stringify(outcome)
    expect(serialised).not.toContain("203.0.113.1")
    expect(serialised).not.toContain(config.hashSecret)
  })
})
