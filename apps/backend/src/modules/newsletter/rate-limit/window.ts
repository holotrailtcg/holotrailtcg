export interface RateLimitWindow {
  windowStart: Date
  windowEndsAt: Date
}

/**
 * Deterministic UTC fixed-window calculation: floor `now` to the nearest
 * multiple of `windowSeconds` epoch seconds. Working in epoch seconds
 * (rather than local calendar time) means the result has no timezone or
 * daylight-saving dependence — the same (request key, window) pair is
 * reachable from any process regardless of its local TZ setting, and never
 * accepts browser-supplied time.
 */
export function resolveRateLimitWindow(now: Date, windowSeconds: number): RateLimitWindow {
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const windowStartSeconds = Math.floor(nowSeconds / windowSeconds) * windowSeconds
  const windowStart = new Date(windowStartSeconds * 1000)
  const windowEndsAt = new Date((windowStartSeconds + windowSeconds) * 1000)
  return { windowStart, windowEndsAt }
}

/** Seconds until the current window ends, clamped to zero (never negative). */
export function computeRetryAfterSeconds(now: Date, windowEndsAt: Date): number {
  const diffMs = windowEndsAt.getTime() - now.getTime()
  return Math.max(0, Math.ceil(diffMs / 1000))
}
