import { z } from "@medusajs/framework/zod"
import { MedusaError } from "@medusajs/framework/utils"
import {
  boundedIntegerString,
  requiredTrimmedString,
  parseEnvSchema,
  type EnvSource,
} from "../shared/env-parsing"

/**
 * Narrow, backend-only configuration for the Resend confirmation-email
 * delivery boundary (Stage 2C.5). This is not the full Stage 2C
 * environment schema (still deferred to Stage 2C.8); it only resolves and
 * validates the values this boundary needs, failing closed in every
 * environment for every required field — no `NODE_ENV` branch decides
 * whether a required value is required.
 *
 * Documented bounds:
 * - cooldown: 0–86,400 seconds (24 hours). Default 300 seconds (5
 *   minutes), matching the cooldown figure the 2C.1 design record already
 *   proposed for repeated pending signups.
 * - stale reservation: 1–3,600 seconds (1 hour). Default 120 seconds (2
 *   minutes) — generous relative to the sender's own 10-second network
 *   timeout, so a reservation is only ever recovered well after any
 *   in-flight request would have settled.
 */
const CONFIRMATION_EMAIL_COOLDOWN_SECONDS_BOUNDS = { min: 0, max: 86_400 } as const
const DEFAULT_CONFIRMATION_EMAIL_COOLDOWN_SECONDS = 300

const CONFIRMATION_EMAIL_STALE_RESERVATION_SECONDS_BOUNDS = { min: 1, max: 3_600 } as const
const DEFAULT_CONFIRMATION_EMAIL_STALE_RESERVATION_SECONDS = 120

export interface ResendConfig {
  apiKey: string
  /** Already validated; "Name <email@example.com>" or a bare address. */
  fromEmail: string
  /** Already validated bare email address. */
  replyToEmail: string
  /** Already validated absolute origin, no path/query/fragment, no trailing slash. */
  storefrontBaseUrl: string
  confirmationEmailCooldownSeconds: number
  confirmationEmailStaleReservationSeconds: number
}

const resendConfigSchema = z.object({
  RESEND_API_KEY: requiredTrimmedString("RESEND_API_KEY"),
  RESEND_FROM_EMAIL: requiredTrimmedString("RESEND_FROM_EMAIL"),
  RESEND_REPLY_TO_EMAIL: requiredTrimmedString("RESEND_REPLY_TO_EMAIL"),
  PUBLIC_STOREFRONT_URL: requiredTrimmedString("PUBLIC_STOREFRONT_URL"),
  NEWSLETTER_CONFIRMATION_EMAIL_COOLDOWN_SECONDS: z.string().optional(),
  NEWSLETTER_CONFIRMATION_EMAIL_STALE_RESERVATION_SECONDS: z.string().optional(),
})

/** A bare email address, no display name, no angle brackets. */
const EMAIL_ADDRESS_PATTERN = /^[^\s@<>"]+@[^\s@<>."]+(?:\.[^\s@<>."]+)+$/

/** `Display Name <email@example.com>` — the format Resend's `from`/`replyTo` fields document. */
const FRIENDLY_ADDRESS_PATTERN = /^[^<>]*<([^<>]+)>$/

function extractSenderEmailAddress(value: string): string | null {
  const trimmed = value.trim()
  const friendlyMatch = trimmed.match(FRIENDLY_ADDRESS_PATTERN)
  const candidate = friendlyMatch ? friendlyMatch[1].trim() : trimmed
  return EMAIL_ADDRESS_PATTERN.test(candidate) ? candidate : null
}

function assertSenderFormat(name: string, value: string): string {
  const trimmed = value.trim()
  if (extractSenderEmailAddress(trimmed) === null) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${name} must be a valid email address, optionally in "Display Name <email@example.com>" format`
    )
  }
  return trimmed
}

function assertReplyToFormat(value: string): string {
  const trimmed = value.trim()
  if (!EMAIL_ADDRESS_PATTERN.test(trimmed)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "RESEND_REPLY_TO_EMAIL must be a valid email address"
    )
  }
  return trimmed
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"])

/**
 * Validates `PUBLIC_STOREFRONT_URL` as a bare absolute origin (no path,
 * query or fragment — those would make confirmation-URL construction
 * ambiguous about where the storefront's own routing takes over). `https:`
 * is required in production; `http:` is accepted outside production only
 * for a local hostname, never an arbitrary domain, so a misconfigured
 * non-production environment cannot be tricked into sending confirmation
 * links over plaintext HTTP to a real host.
 */
function assertStorefrontBaseUrl(value: string, isProduction: boolean): string {
  const trimmed = value.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "PUBLIC_STOREFRONT_URL must be an absolute URL"
    )
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "PUBLIC_STOREFRONT_URL must use the http or https scheme"
    )
  }

  if (isProduction && parsed.protocol !== "https:") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "PUBLIC_STOREFRONT_URL must use https in production"
    )
  }

  if (!isProduction && parsed.protocol === "http:" && !LOCAL_HOSTNAMES.has(parsed.hostname)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "PUBLIC_STOREFRONT_URL may only use http for a local hostname (localhost/127.0.0.1/::1)"
    )
  }

  if (parsed.search || parsed.hash) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "PUBLIC_STOREFRONT_URL must not include a query string or fragment"
    )
  }

  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "PUBLIC_STOREFRONT_URL must be a bare origin, without a path"
    )
  }

  // Normalise away a trailing slash so confirmation-URL construction never
  // has to reason about it.
  return parsed.origin
}

/**
 * Resolves and validates the Resend confirmation-email configuration.
 * There is no environment-specific default for the required fields — a
 * missing or malformed `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
 * `RESEND_REPLY_TO_EMAIL` or `PUBLIC_STOREFRONT_URL` throws in every
 * environment, which is what makes "production fails closed on missing
 * configuration" true by construction. The one environment-*dependent*
 * check (`https:` required in production) is an explicit, narrow exception
 * documented above, not a general pattern used elsewhere in this reader.
 */
export function resolveResendConfig(env: EnvSource = process.env): ResendConfig {
  const parsed = parseEnvSchema(resendConfigSchema, env)
  const isProduction = env.NODE_ENV === "production"

  let confirmationEmailCooldownSeconds = DEFAULT_CONFIRMATION_EMAIL_COOLDOWN_SECONDS
  if (parsed.NEWSLETTER_CONFIRMATION_EMAIL_COOLDOWN_SECONDS !== undefined) {
    confirmationEmailCooldownSeconds = parseEnvSchema(
      boundedIntegerString(
        "NEWSLETTER_CONFIRMATION_EMAIL_COOLDOWN_SECONDS",
        CONFIRMATION_EMAIL_COOLDOWN_SECONDS_BOUNDS
      ),
      parsed.NEWSLETTER_CONFIRMATION_EMAIL_COOLDOWN_SECONDS
    )
  }

  let confirmationEmailStaleReservationSeconds = DEFAULT_CONFIRMATION_EMAIL_STALE_RESERVATION_SECONDS
  if (parsed.NEWSLETTER_CONFIRMATION_EMAIL_STALE_RESERVATION_SECONDS !== undefined) {
    confirmationEmailStaleReservationSeconds = parseEnvSchema(
      boundedIntegerString(
        "NEWSLETTER_CONFIRMATION_EMAIL_STALE_RESERVATION_SECONDS",
        CONFIRMATION_EMAIL_STALE_RESERVATION_SECONDS_BOUNDS
      ),
      parsed.NEWSLETTER_CONFIRMATION_EMAIL_STALE_RESERVATION_SECONDS
    )
  }

  return {
    apiKey: parsed.RESEND_API_KEY,
    fromEmail: assertSenderFormat("RESEND_FROM_EMAIL", parsed.RESEND_FROM_EMAIL),
    replyToEmail: assertReplyToFormat(parsed.RESEND_REPLY_TO_EMAIL),
    storefrontBaseUrl: assertStorefrontBaseUrl(parsed.PUBLIC_STOREFRONT_URL, isProduction),
    confirmationEmailCooldownSeconds,
    confirmationEmailStaleReservationSeconds,
  }
}
