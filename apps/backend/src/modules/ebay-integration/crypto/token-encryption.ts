import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { MedusaError } from "@medusajs/framework/utils"

const ALGORITHM = "aes-256-gcm"
const KEY_BYTES = 32
const IV_BYTES = 12

export interface EncryptedToken {
  ciphertext: string
  iv: string
  authTag: string
  keyVersion: string
}

export interface TokenEncryptionKeyring {
  activeVersion: string
  keys: ReadonlyMap<string, Buffer>
}

function safeEncryptionError(): MedusaError {
  return new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The stored eBay credential could not be processed.")
}

function decodeKey(encoded: unknown): Buffer {
  if (typeof encoded !== "string" || !encoded) throw safeEncryptionError()
  const key = Buffer.from(encoded, "base64")
  if (key.length !== KEY_BYTES || key.toString("base64") !== encoded) throw safeEncryptionError()
  return key
}

export function resolveTokenEncryptionKeyring(env: NodeJS.ProcessEnv = process.env): TokenEncryptionKeyring {
  const version = env.EBAY_TOKEN_ENCRYPTION_KEY_VERSION?.trim()
  const encoded = env.EBAY_TOKEN_ENCRYPTION_KEY?.trim()
  if (!version || !/^[A-Za-z0-9_-]{1,32}$/.test(version) || !encoded) throw safeEncryptionError()
  const keys = new Map<string, Buffer>()
  try {
    const retained = env.EBAY_TOKEN_ENCRYPTION_KEYS_JSON?.trim()
    if (retained) {
      const parsed: unknown = JSON.parse(retained)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw safeEncryptionError()
      for (const [retainedVersion, retainedKey] of Object.entries(parsed)) {
        if (!/^[A-Za-z0-9_-]{1,32}$/.test(retainedVersion)) throw safeEncryptionError()
        if (retainedVersion === version) throw safeEncryptionError()
        keys.set(retainedVersion, decodeKey(retainedKey))
      }
    }
    keys.set(version, decodeKey(encoded))
  } catch {
    throw safeEncryptionError()
  }
  return { activeVersion: version, keys }
}

export function encryptRefreshToken(plaintext: string, keyring: TokenEncryptionKeyring): EncryptedToken {
  if (!plaintext) throw safeEncryptionError()
  const key = keyring.keys.get(keyring.activeVersion)
  if (!key || key.length !== KEY_BYTES) throw safeEncryptionError()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: keyring.activeVersion,
  }
}

export function decryptRefreshToken(encrypted: EncryptedToken, keyring: TokenEncryptionKeyring): string {
  const key = keyring.keys.get(encrypted.keyVersion)
  if (!key || key.length !== KEY_BYTES) throw safeEncryptionError()
  try {
    const iv = Buffer.from(encrypted.iv, "base64")
    const tag = Buffer.from(encrypted.authTag, "base64")
    const ciphertext = Buffer.from(encrypted.ciphertext, "base64")
    if (iv.length !== IV_BYTES || tag.length !== 16 || ciphertext.length === 0) throw safeEncryptionError()
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
  } catch {
    throw safeEncryptionError()
  }
}
