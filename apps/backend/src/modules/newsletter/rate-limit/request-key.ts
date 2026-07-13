import { createHmac } from "node:crypto"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * Derives the pseudonymous rate-limit bucket key from a validated client
 * address: HMAC-SHA-256 of the address, keyed by
 * `NEWSLETTER_RATE_LIMIT_HASH_SECRET`, hex-encoded (64 characters — the
 * full digest, never truncated). HMAC (not a plain hash) is used
 * deliberately: a plain SHA-256 of an IP address is guessable/rainbow-
 * -tableable (the input space is small), whereas HMAC requires the
 * server-only secret to reproduce or reverse, and rotating the secret
 * invalidates every existing bucket in one step.
 *
 * The raw address is never returned, stored, or logged by this function —
 * only the derived key.
 */
export function deriveRateLimitRequestKey(
  clientAddress: string,
  hashSecret: string
): string {
  if (typeof clientAddress !== "string" || clientAddress.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "clientAddress must not be empty"
    )
  }
  if (typeof hashSecret !== "string" || hashSecret.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "hashSecret must not be empty"
    )
  }

  return createHmac("sha256", hashSecret).update(clientAddress, "utf8").digest("hex")
}
