import { createHash } from "node:crypto"

/**
 * Derives Resend's `Idempotency-Key` for a confirmation-email send
 * (docs/decisions/0005-newsletter-backend-design.md). Deterministic and
 * stable for one logical send attempt: the same `(subscriberId,
 * confirmationTokenHash)` pair always yields the same key, so a retry
 * against the same token generation reuses it, while a token rotation
 * (a new `confirmationTokenHash`) always yields a different key.
 *
 * Built only from the subscriber id and the already-hashed confirmation
 * token — never the plaintext token, never the email address — and
 * namespaced so it cannot collide with an idempotency key derived
 * elsewhere in the codebase for an unrelated purpose. The output is a
 * 64-character hex digest, comfortably within Resend's documented 256
 * character idempotency-key limit.
 */
const IDEMPOTENCY_KEY_NAMESPACE = "newsletter-confirmation-email:v1"

export function deriveConfirmationEmailIdempotencyKey(
  subscriberId: string,
  confirmationTokenHash: string
): string {
  const material = `${IDEMPOTENCY_KEY_NAMESPACE}:${subscriberId}:${confirmationTokenHash}`
  return createHash("sha256").update(material, "utf8").digest("hex")
}
