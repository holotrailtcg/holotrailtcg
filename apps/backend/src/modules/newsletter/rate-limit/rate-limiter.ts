import type { RateLimitConfig } from "./config"
import { deriveRateLimitRequestKey } from "./request-key"
import { resolveRateLimitWindow, computeRetryAfterSeconds } from "./window"
import type { RateLimitOutcome } from "./types"

/**
 * The minimal persistence contract this orchestrator needs — satisfied by
 * `NewsletterModuleService.incrementRateLimitBucket` in production, and by
 * a plain fake in unit tests. Keeping this as a narrow interface (rather
 * than importing the module service directly) is what makes
 * `checkRateLimit` testable without a database.
 */
export interface RateLimitBucketStore {
  incrementRateLimitBucket(requestKey: string, windowStart: Date): Promise<number>
}

export interface CheckRateLimitInput {
  store: RateLimitBucketStore
  clientAddress: string
  config: RateLimitConfig
  /** Injected only for deterministic tests; production always uses `new Date()`. */
  now?: Date
}

/**
 * Atomically increments the caller's rate-limit bucket and decides whether
 * the request is allowed.
 *
 * Fails closed: HMAC derivation failure or a database error is caught here
 * and turned into a denial (`allowed: false`) — this function must never
 * resolve with `allowed: true` on a configuration or database failure.
 * `reason` is internal diagnostics only; callers must not expose it
 * verbatim to the public.
 *
 * Threshold semantics: a resulting count `<= config.maxRequests` is
 * allowed; a count strictly greater than `config.maxRequests` is denied.
 * The bucket itself is never deleted on denial — the next window resets it
 * naturally.
 */
export async function checkRateLimit(input: CheckRateLimitInput): Promise<RateLimitOutcome> {
  const now = input.now ?? new Date()
  const { windowStart, windowEndsAt } = resolveRateLimitWindow(now, input.config.windowSeconds)
  const retryAfterSeconds = computeRetryAfterSeconds(now, windowEndsAt)

  let requestKey: string
  try {
    requestKey = deriveRateLimitRequestKey(input.clientAddress, input.config.hashSecret)
  } catch {
    return {
      allowed: false,
      limit: input.config.maxRequests,
      remaining: 0,
      retryAfterSeconds,
      windowEndsAt,
      reason: "ADDRESS_UNTRUSTED",
    }
  }

  let count: number
  try {
    count = await input.store.incrementRateLimitBucket(requestKey, windowStart)
  } catch {
    return {
      allowed: false,
      limit: input.config.maxRequests,
      remaining: 0,
      retryAfterSeconds,
      windowEndsAt,
      reason: "DATABASE_ERROR",
    }
  }

  const remaining = Math.max(0, input.config.maxRequests - count)

  if (count > input.config.maxRequests) {
    return {
      allowed: false,
      limit: input.config.maxRequests,
      remaining,
      retryAfterSeconds,
      windowEndsAt,
      reason: "LIMIT_EXCEEDED",
    }
  }

  return {
    allowed: true,
    limit: input.config.maxRequests,
    remaining,
    retryAfterSeconds,
    windowEndsAt,
  }
}
