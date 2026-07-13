import { z } from "@medusajs/framework/zod"
import { MedusaError } from "@medusajs/framework/utils"
import {
  boundedIntegerString,
  requiredTrimmedString,
  boundedNumberString,
  parseEnvSchema,
  type EnvSource,
} from "../shared/env-parsing"

/**
 * Google documents reCAPTCHA v3 scores in the closed range [0.0, 1.0], and
 * tokens as short-lived/single-use (in practice valid for roughly two
 * minutes). These bounds are conservative reflections of that:
 *
 * - min score: 0 .. 1 inclusive (0 is a legitimate, if permissive,
 *   configuration — it accepts every score Google returns).
 * - max token age: 1 .. 300 seconds. Default 120 seconds (~2 minutes,
 *   matching Google's documented token lifetime); 300 seconds (5 minutes)
 *   is a generous outer ceiling for a misconfigured deployment, not a
 *   recommended value.
 */
const MIN_SCORE_BOUNDS = { min: 0, max: 1 } as const
const MAX_TOKEN_AGE_SECONDS_BOUNDS = { min: 1, max: 300 } as const
const DEFAULT_MAX_TOKEN_AGE_SECONDS = 120

export interface RecaptchaConfig {
  secretKey: string
  minScore: number
  /** `null` disables hostname validation. */
  allowedHostnames: string[] | null
  maxTokenAgeSeconds: number
}

const recaptchaConfigSchema = z.object({
  RECAPTCHA_SECRET_KEY: requiredTrimmedString("RECAPTCHA_SECRET_KEY"),
  NEWSLETTER_RECAPTCHA_MIN_SCORE: boundedNumberString(
    "NEWSLETTER_RECAPTCHA_MIN_SCORE",
    MIN_SCORE_BOUNDS
  ),
  NEWSLETTER_RECAPTCHA_ALLOWED_HOSTNAMES: z.string().optional(),
  NEWSLETTER_RECAPTCHA_MAX_TOKEN_AGE_SECONDS: z.string().optional(),
})

const HOSTNAME_PATTERN =
  /^(localhost|[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*)$/i

function parseAllowedHostnames(raw: string | undefined): string[] | null {
  if (raw === undefined || raw.trim() === "") {
    return null
  }

  const hostnames = raw
    .split(",")
    .map((hostname) => hostname.trim())
    .filter((hostname) => hostname.length > 0)

  if (hostnames.length === 0) {
    return null
  }

  for (const hostname of hostnames) {
    if (!HOSTNAME_PATTERN.test(hostname)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `NEWSLETTER_RECAPTCHA_ALLOWED_HOSTNAMES contains an invalid hostname: "${hostname}"`
      )
    }
  }

  return hostnames
}

/**
 * Resolves and validates the reCAPTCHA verification configuration. Like
 * the rate-limit config, there is no environment-specific default for the
 * required fields — a missing or malformed `RECAPTCHA_SECRET_KEY` or
 * `NEWSLETTER_RECAPTCHA_MIN_SCORE` throws in every environment, which is
 * what makes "production fails closed on missing configuration" true by
 * construction rather than by an explicit `NODE_ENV` branch.
 */
export function resolveRecaptchaConfig(env: EnvSource = process.env): RecaptchaConfig {
  const parsed = parseEnvSchema(recaptchaConfigSchema, env)

  let maxTokenAgeSeconds = DEFAULT_MAX_TOKEN_AGE_SECONDS
  if (parsed.NEWSLETTER_RECAPTCHA_MAX_TOKEN_AGE_SECONDS !== undefined) {
    maxTokenAgeSeconds = parseEnvSchema(
      boundedIntegerString(
        "NEWSLETTER_RECAPTCHA_MAX_TOKEN_AGE_SECONDS",
        MAX_TOKEN_AGE_SECONDS_BOUNDS
      ),
      parsed.NEWSLETTER_RECAPTCHA_MAX_TOKEN_AGE_SECONDS
    )
  }

  return {
    secretKey: parsed.RECAPTCHA_SECRET_KEY,
    minScore: parsed.NEWSLETTER_RECAPTCHA_MIN_SCORE,
    allowedHostnames: parseAllowedHostnames(parsed.NEWSLETTER_RECAPTCHA_ALLOWED_HOSTNAMES),
    maxTokenAgeSeconds,
  }
}
