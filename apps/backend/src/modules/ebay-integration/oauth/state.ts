import { createHash, randomBytes } from "node:crypto"

export function generateOAuthState(): string {
  return randomBytes(32).toString("base64url")
}

export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex")
}
