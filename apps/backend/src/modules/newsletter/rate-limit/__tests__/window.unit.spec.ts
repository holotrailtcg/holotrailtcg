import { resolveRateLimitWindow, computeRetryAfterSeconds } from "../window"

describe("resolveRateLimitWindow", () => {
  it("resolves the same window for two timestamps in the same range", () => {
    const windowSeconds = 60
    const a = resolveRateLimitWindow(new Date("2026-07-13T12:00:00.000Z"), windowSeconds)
    const b = resolveRateLimitWindow(new Date("2026-07-13T12:00:59.999Z"), windowSeconds)
    expect(a.windowStart.getTime()).toBe(b.windowStart.getTime())
  })

  it("moves to the next window at the boundary", () => {
    const windowSeconds = 60
    const a = resolveRateLimitWindow(new Date("2026-07-13T12:00:59.999Z"), windowSeconds)
    const b = resolveRateLimitWindow(new Date("2026-07-13T12:01:00.000Z"), windowSeconds)
    expect(b.windowStart.getTime()).toBeGreaterThan(a.windowStart.getTime())
  })

  it("floors to a UTC epoch-second boundary regardless of local timezone", () => {
    const windowSeconds = 60
    const { windowStart } = resolveRateLimitWindow(new Date("2026-07-13T12:00:30.000Z"), windowSeconds)
    expect(windowStart.toISOString()).toBe("2026-07-13T12:00:00.000Z")
  })

  it("computes windowEndsAt exactly windowSeconds after windowStart", () => {
    const windowSeconds = 60
    const { windowStart, windowEndsAt } = resolveRateLimitWindow(
      new Date("2026-07-13T12:00:30.000Z"),
      windowSeconds
    )
    expect(windowEndsAt.getTime() - windowStart.getTime()).toBe(windowSeconds * 1000)
  })
})

describe("computeRetryAfterSeconds", () => {
  it("returns the remaining seconds until the window ends", () => {
    const now = new Date("2026-07-13T12:00:30.000Z")
    const windowEndsAt = new Date("2026-07-13T12:01:00.000Z")
    expect(computeRetryAfterSeconds(now, windowEndsAt)).toBe(30)
  })

  it("clamps to zero for an already-active window that has technically ended", () => {
    const now = new Date("2026-07-13T12:01:05.000Z")
    const windowEndsAt = new Date("2026-07-13T12:01:00.000Z")
    expect(computeRetryAfterSeconds(now, windowEndsAt)).toBe(0)
  })

  it("does not treat the currently active window as expired", () => {
    const now = new Date("2026-07-13T12:00:00.000Z")
    const windowEndsAt = new Date("2026-07-13T12:01:00.000Z")
    expect(computeRetryAfterSeconds(now, windowEndsAt)).toBeGreaterThan(0)
  })
})
