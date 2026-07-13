import { createHash, randomBytes } from "node:crypto"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * 32 random bytes = 256 bits of entropy per token, base64url-encoded (no
 * padding) so the value is safe to place directly in a URL query string.
 * No email address, subscriber id or timestamp is embedded — the token is
 * opaque and carries no meaning outside the database row it hashes to.
 */
const TOKEN_BYTES = 32

export function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url")
}

/**
 * SHA-256 of the token string, encoded as lower-case hex. No salt: the
 * input already carries 256 bits of entropy, so the property being
 * defended is "a database dump does not reveal usable tokens", not
 * resistance to offline brute-force of a low-entropy secret — a slow KDF
 * (bcrypt/argon2) would add cost without adding protection here. Lookup is
 * a single equality comparison against a unique index; the "does this hash
 * exist" timing signal leaks no more than the already-observable outcome
 * (valid vs invalid token), so no constant-time comparison is required for
 * the database lookup itself.
 */
export function hashToken(token: string): string {
  if (typeof token !== "string" || token.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "token must be a non-empty string"
    )
  }

  return createHash("sha256").update(token, "utf8").digest("hex")
}
