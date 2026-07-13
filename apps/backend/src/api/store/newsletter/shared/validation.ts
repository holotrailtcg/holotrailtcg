import { z } from "@medusajs/framework/zod"
import { isSupportedCountryCode } from "../../../../modules/newsletter/resend/confirmation-url"

/**
 * Strict backend validation for the public newsletter routes. This is
 * deliberately separate from `lifecycle/clean-input.ts` (storage-safety
 * cleaning only, per its own docstring) — this schema is the public input
 * boundary, so it rejects malformed requests before any abuse control,
 * database lookup, or external call ever runs.
 */

const MAX_FIRST_NAME_LENGTH = 100
const MAX_EMAIL_LENGTH = 254
const MAX_HONEYPOT_LENGTH = 200
const MAX_RECAPTCHA_TOKEN_LENGTH = 4096
const MAX_TOKEN_QUERY_LENGTH = 1024

/** Conservative email shape check, matching the storefront's own pattern
 * (`apps/storefront/src/lib/newsletter/validation.ts`) — not full RFC
 * validation, which is neither necessary nor desirable at this boundary. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * base64url charset (no padding) — the exact shape `generateOpaqueToken`
 * (`lifecycle/token.ts`) produces. Anything outside this shape cannot be a
 * real token, so it is rejected before ever reaching a hash/lookup.
 */
const TOKEN_QUERY_PATTERN = /^[A-Za-z0-9_-]+$/

/**
 * Consent must be an explicit boolean `true` and nothing else. `z.literal`
 * fails closed by construction: it fails the type check for any value that
 * is not `=== true`, which already rejects `false`, `"true"`, `"false"`,
 * `1`, `0`, arrays and objects — no separate coercion path exists for any
 * of those to slip through.
 */
const strictConsentTrue = z.literal(true, {
  error: "consent must be exactly true",
})

export const subscribeBodySchema = z
  .object({
    firstName: z
      .string({ error: "firstName is required" })
      .trim()
      .min(1, "firstName must not be empty")
      .max(MAX_FIRST_NAME_LENGTH, `firstName must be ${MAX_FIRST_NAME_LENGTH} characters or fewer`),
    email: z
      .string({ error: "email is required" })
      .trim()
      .max(MAX_EMAIL_LENGTH, `email must be ${MAX_EMAIL_LENGTH} characters or fewer`)
      .regex(EMAIL_PATTERN, "email must be a valid email address"),
    consent: strictConsentTrue,
    honeypot: z
      .string()
      .max(MAX_HONEYPOT_LENGTH, "honeypot exceeds the maximum accepted length")
      .optional(),
    recaptchaToken: z
      .string({ error: "recaptchaToken is required" })
      .trim()
      .min(1, "recaptchaToken must not be empty")
      .max(MAX_RECAPTCHA_TOKEN_LENGTH, "recaptchaToken exceeds the maximum accepted length"),
    countryCode: z
      .string({ error: "countryCode is required" })
      .trim()
      .toLowerCase()
      .refine(isSupportedCountryCode, "countryCode must be a supported two-letter lower-case code"),
  })
  .strict()

export type SubscribeBody = z.infer<typeof subscribeBodySchema>

export const tokenQuerySchema = z.object({
  token: z
    .string({ error: "token is required" })
    .trim()
    .min(1, "token must not be empty")
    .max(MAX_TOKEN_QUERY_LENGTH, "token exceeds the maximum accepted length")
    .regex(TOKEN_QUERY_PATTERN, "token has an unsupported shape"),
})

export type TokenQuery = z.infer<typeof tokenQuerySchema>
