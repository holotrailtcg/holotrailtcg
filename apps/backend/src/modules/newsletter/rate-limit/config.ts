import { z } from "@medusajs/framework/zod"
import {
  boundedIntegerString,
  requiredTrimmedString,
  parseEnvSchema,
  type EnvSource,
} from "../shared/env-parsing"

/**
 * Conservative, documented bounds (Stage 2C.8 has not yet introduced a
 * repo-wide environment schema, so these live here):
 *
 * - window: 1 second .. 86,400 seconds (24 hours) — a newsletter-signup
 *   rate limit has no legitimate reason to span longer than a day; a
 *   shorter window is the normal case.
 * - max requests: 1 .. 1,000 per window — generous enough to tolerate a
 *   shared NAT/office IP hammering the form by accident, far below
 *   anything a scraper actually needs.
 * - hash secret: at least 32 characters — comparable to 256 bits of
 *   entropy when generated as a random hex/base64 string (e.g. `openssl
 *   rand -hex 32`), so a stolen bucket table cannot be brute-forced back
 *   to a raw address.
 */
export const RATE_LIMIT_WINDOW_SECONDS_BOUNDS = { min: 1, max: 86_400 } as const
export const RATE_LIMIT_MAX_REQUESTS_BOUNDS = { min: 1, max: 1_000 } as const
export const RATE_LIMIT_HASH_SECRET_MIN_LENGTH = 32

export interface RateLimitConfig {
  windowSeconds: number
  maxRequests: number
  hashSecret: string
}

const rateLimitConfigSchema = z.object({
  NEWSLETTER_RATE_LIMIT_WINDOW_SECONDS: boundedIntegerString(
    "NEWSLETTER_RATE_LIMIT_WINDOW_SECONDS",
    RATE_LIMIT_WINDOW_SECONDS_BOUNDS
  ),
  NEWSLETTER_RATE_LIMIT_MAX_REQUESTS: boundedIntegerString(
    "NEWSLETTER_RATE_LIMIT_MAX_REQUESTS",
    RATE_LIMIT_MAX_REQUESTS_BOUNDS
  ),
  NEWSLETTER_RATE_LIMIT_HASH_SECRET: requiredTrimmedString(
    "NEWSLETTER_RATE_LIMIT_HASH_SECRET"
  ).min(
    RATE_LIMIT_HASH_SECRET_MIN_LENGTH,
    `NEWSLETTER_RATE_LIMIT_HASH_SECRET must be at least ${RATE_LIMIT_HASH_SECRET_MIN_LENGTH} characters`
  ),
})

/**
 * Resolves and validates the rate-limit configuration. There is no
 * environment-specific default and no silent fallback: every required
 * value must be present and valid, in every environment, or this throws.
 * That is what makes production "fail closed" here — nothing downstream
 * can be reached without a successful call to this function.
 */
export function resolveRateLimitConfig(env: EnvSource = process.env): RateLimitConfig {
  const parsed = parseEnvSchema(rateLimitConfigSchema, env)
  return {
    windowSeconds: parsed.NEWSLETTER_RATE_LIMIT_WINDOW_SECONDS,
    maxRequests: parsed.NEWSLETTER_RATE_LIMIT_MAX_REQUESTS,
    hashSecret: parsed.NEWSLETTER_RATE_LIMIT_HASH_SECRET,
  }
}
