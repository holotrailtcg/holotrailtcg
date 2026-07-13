import { MedusaError } from "@medusajs/framework/utils"

const MAX_EMAIL_LENGTH = 254

export interface NormalisedEmail {
  email: string
  normalisedEmail: string
}

/**
 * Normalisation strategy (deliberately minimal, per Stage 2C.3 scope):
 *
 * 1. Require a string; trim surrounding whitespace.
 * 2. Reject empty input or input exceeding the database's 254-character
 *    bound (matches `CK_newsletter_subscriber_email_length` /
 *    `..._normalised_email_length`).
 * 3. The canonical uniqueness key (`normalisedEmail`) lower-cases the whole
 *    address — local part and domain alike. This is a simple, deterministic,
 *    provider-agnostic rule: it does not strip dots, does not strip "+"
 *    aliases, and applies no Gmail-specific behaviour. RFC 5321 technically
 *    allows a case-sensitive local part, but real-world mail providers
 *    overwhelmingly treat it case-insensitively, so lower-casing the full
 *    address is a pragmatic, auditable choice for the uniqueness key rather
 *    than an attempt at full RFC mailbox canonicalisation (which is
 *    explicitly out of scope — no quoted-string parsing, no comment
 *    stripping, no IDNA/punycode domain handling).
 * 4. The stored *display* email (`email`) preserves the sender's original
 *    casing — only whitespace is trimmed. Only `normalisedEmail` is
 *    lower-cased.
 */
export function normaliseEmail(raw: string): NormalisedEmail {
  if (typeof raw !== "string") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "email must be a string")
  }

  const trimmed = raw.trim()

  if (!trimmed) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "email must not be empty")
  }

  if (trimmed.length > MAX_EMAIL_LENGTH) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `email exceeds ${MAX_EMAIL_LENGTH} characters`
    )
  }

  return { email: trimmed, normalisedEmail: trimmed.toLowerCase() }
}
