import { computeRateLimitCleanupCutoff } from "../cleanup"

describe("computeRateLimitCleanupCutoff", () => {
  it("computes a cutoff windowSeconds * retentionWindows before now", () => {
    const now = new Date("2026-07-13T12:00:00.000Z")
    const cutoff = computeRateLimitCleanupCutoff(now, 60, 3)
    expect(cutoff.toISOString()).toBe("2026-07-13T11:57:00.000Z")
  })

  it("always resolves to a cutoff strictly before the active window start", () => {
    const now = new Date("2026-07-13T12:00:30.000Z")
    const windowSeconds = 60
    const activeWindowStart = new Date("2026-07-13T12:00:00.000Z")
    const cutoff = computeRateLimitCleanupCutoff(now, windowSeconds, 1)
    expect(cutoff.getTime()).toBeLessThan(activeWindowStart.getTime())
  })
})
