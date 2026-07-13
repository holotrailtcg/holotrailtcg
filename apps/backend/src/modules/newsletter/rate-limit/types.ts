/**
 * Internal-only denial reasons. A future public route must map every one
 * of these to the same generic public response — none of them (nor any
 * other field on `RateLimitOutcome`) is intended to reach an untrusted
 * caller directly.
 */
export type RateLimitDenialReason =
  | "LIMIT_EXCEEDED"
  | "CONFIG_ERROR"
  | "ADDRESS_UNTRUSTED"
  | "DATABASE_ERROR"

export type RateLimitOutcome =
  | {
      allowed: true
      limit: number
      remaining: number
      retryAfterSeconds: number
      windowEndsAt: Date
    }
  | {
      allowed: false
      limit: number
      remaining: number
      retryAfterSeconds: number
      windowEndsAt: Date
      reason: RateLimitDenialReason
    }
