import { afterEach, describe, expect, it, vi } from "vitest"

import { devNewsletterAdapter } from "./dev-adapter"

const submission = {
  firstName: "Sam",
  email: "sam@example.com",
  consent: true,
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("devNewsletterAdapter fail-closed guard", () => {
  it("reports success only when NODE_ENV is development", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.useFakeTimers()

    const pending = devNewsletterAdapter.submit(submission)
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result.status).toBe("success")
  })

  it("fails closed with the recoverable error state when NODE_ENV is production", async () => {
    vi.stubEnv("NODE_ENV", "production")

    const result = await devNewsletterAdapter.submit(submission)

    expect(result.status).toBe("error")
  })

  it("fails closed with the recoverable error state when NODE_ENV is test", async () => {
    vi.stubEnv("NODE_ENV", "test")

    const result = await devNewsletterAdapter.submit(submission)

    expect(result.status).toBe("error")
  })

  it("fails closed when NODE_ENV is unset", async () => {
    // `vi.stubEnv` requires a string, so a genuinely missing var is set up and
    // torn down manually rather than relying on `unstubAllEnvs`.
    const original = process.env.NODE_ENV
    delete (process.env as { NODE_ENV?: string }).NODE_ENV

    try {
      expect(process.env.NODE_ENV).toBeUndefined()
      const result = await devNewsletterAdapter.submit(submission)
      expect(result.status).toBe("error")
    } finally {
      if (original === undefined) {
        delete (process.env as { NODE_ENV?: string }).NODE_ENV
      } else {
        ;(process.env as { NODE_ENV?: string }).NODE_ENV = original
      }
    }
  })

  it("fails closed when NODE_ENV is an empty string", async () => {
    vi.stubEnv("NODE_ENV", "")

    const result = await devNewsletterAdapter.submit(submission)

    expect(result.status).toBe("error")
  })

  it("fails closed for a custom/staging-like NODE_ENV value", async () => {
    vi.stubEnv("NODE_ENV", "staging")

    const result = await devNewsletterAdapter.submit(submission)

    expect(result.status).toBe("error")
  })

  it("does not simulate latency or log on any non-development path", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    vi.useFakeTimers()

    // Resolves immediately: no timers are pending on the fail-closed path.
    const result = await devNewsletterAdapter.submit(submission)

    expect(result.status).toBe("error")
    expect(info).not.toHaveBeenCalled()
  })
})
