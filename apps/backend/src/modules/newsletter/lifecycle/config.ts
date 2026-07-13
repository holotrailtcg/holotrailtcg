import { MedusaError } from "@medusajs/framework/utils"

/**
 * Narrow reader for `NEWSLETTER_CONFIRMATION_TOKEN_TTL_MINUTES`. This is not
 * the full Stage 2C environment schema (that lands in Stage 2C.8) — it only
 * resolves and validates the one value the confirmation lifecycle needs,
 * failing loudly on an unsafe value rather than silently accepting one.
 */
const DEFAULT_TTL_MINUTES = 60
const MAX_TTL_MINUTES = 10_080 // 7 days — generous upper bound against a misconfigured, effectively-permanent token

/**
 * Resolves the confirmation-token TTL in minutes.
 *
 * `overrideMinutes` exists only for deterministic test control (e.g.
 * asserting expiry behaviour without waiting on real time) and never
 * changes production behaviour: production always resolves from
 * `NEWSLETTER_CONFIRMATION_TOKEN_TTL_MINUTES`, or the documented default if
 * unset.
 */
export function resolveConfirmationTokenTtlMinutes(overrideMinutes?: number): number {
  if (overrideMinutes !== undefined) {
    return assertValidTtl(overrideMinutes)
  }

  const raw = process.env.NEWSLETTER_CONFIRMATION_TOKEN_TTL_MINUTES

  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_TTL_MINUTES
  }

  return assertValidTtl(Number(raw))
}

function assertValidTtl(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0 || value > MAX_TTL_MINUTES) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `NEWSLETTER_CONFIRMATION_TOKEN_TTL_MINUTES must be a positive integer minute count no greater than ${MAX_TTL_MINUTES}, got: ${String(value)}`
    )
  }
  return value
}
