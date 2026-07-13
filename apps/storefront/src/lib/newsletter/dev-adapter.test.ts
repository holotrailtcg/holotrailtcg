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

describe("devNewsletterAdapter production guard", () => {
  it("fails closed with the recoverable error state when NODE_ENV is production", async () => {
    vi.stubEnv("NODE_ENV", "production")

    const result = await devNewsletterAdapter.submit(submission)

    // It must never report a fake success in production.
    expect(result.status).toBe("error")
  })

  it("does not simulate latency or log in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    vi.useFakeTimers()

    // Resolves immediately: no timers are pending on the production path.
    const result = await devNewsletterAdapter.submit(submission)

    expect(result.status).toBe("error")
    expect(info).not.toHaveBeenCalled()
  })

  it("reports success only in development", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.useFakeTimers()

    const pending = devNewsletterAdapter.submit(submission)
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result.status).toBe("success")
  })
})
