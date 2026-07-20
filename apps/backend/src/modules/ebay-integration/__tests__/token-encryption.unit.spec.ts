import { randomBytes } from "node:crypto"
import {
  decryptRefreshToken, encryptRefreshToken, resolveTokenEncryptionKeyring,
  type EncryptedToken,
} from "../crypto/token-encryption"

const key = randomBytes(32)
const keyring = { activeVersion: "v1", keys: new Map([["v1", key]]) }

describe("eBay refresh-token encryption", () => {
  it("round-trips and uses a unique IV and ciphertext", () => {
    const first = encryptRefreshToken("refresh-token", keyring)
    const second = encryptRefreshToken("refresh-token", keyring)
    expect(decryptRefreshToken(first, keyring)).toBe("refresh-token")
    expect(first.iv).not.toBe(second.iv)
    expect(first.ciphertext).not.toBe(second.ciphertext)
  })

  it.each(["ciphertext", "iv", "authTag"] as const)("rejects tampered %s", (field) => {
    const encrypted = encryptRefreshToken("refresh-token", keyring)
    const tampered: EncryptedToken = { ...encrypted, [field]: `${encrypted[field].slice(0, -2)}AA` }
    expect(() => decryptRefreshToken(tampered, keyring)).toThrow("could not be processed")
  })

  it("rejects a wrong key and unknown key version without leaking the token", () => {
    const marker = "SECRET_REFRESH_TOKEN_SENTINEL"
    const encrypted = encryptRefreshToken(marker, keyring)
    const wrong = { activeVersion: "v1", keys: new Map([["v1", randomBytes(32)]]) }
    expect(() => decryptRefreshToken(encrypted, wrong)).toThrow("could not be processed")
    expect(() => decryptRefreshToken({ ...encrypted, keyVersion: "v2" }, keyring)).toThrow("could not be processed")
    try {
      decryptRefreshToken(encrypted, wrong)
    } catch (error) {
      expect(String(error)).not.toContain(marker)
    }
  })

  it("validates exact base64 key length and version", () => {
    expect(resolveTokenEncryptionKeyring({
      EBAY_TOKEN_ENCRYPTION_KEY_VERSION: "v1",
      EBAY_TOKEN_ENCRYPTION_KEY: key.toString("base64"),
    } as NodeJS.ProcessEnv).keys.get("v1")).toEqual(key)
    expect(() => resolveTokenEncryptionKeyring({
      EBAY_TOKEN_ENCRYPTION_KEY_VERSION: "v1",
      EBAY_TOKEN_ENCRYPTION_KEY: randomBytes(16).toString("base64"),
    } as NodeJS.ProcessEnv)).toThrow("could not be processed")
  })

  it("retains validated previous key versions for controlled rotation", () => {
    const previous = randomBytes(32)
    const resolved = resolveTokenEncryptionKeyring({
      EBAY_TOKEN_ENCRYPTION_KEY_VERSION: "v2",
      EBAY_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      EBAY_TOKEN_ENCRYPTION_KEYS_JSON: JSON.stringify({ v1: previous.toString("base64") }),
    } as NodeJS.ProcessEnv)
    expect(resolved.keys.get("v1")).toEqual(previous)
    expect(() => resolveTokenEncryptionKeyring({
      EBAY_TOKEN_ENCRYPTION_KEY_VERSION: "v2",
      EBAY_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      EBAY_TOKEN_ENCRYPTION_KEYS_JSON: JSON.stringify({ v1: "not-a-key" }),
    } as NodeJS.ProcessEnv)).toThrow("could not be processed")
    expect(() => resolveTokenEncryptionKeyring({
      EBAY_TOKEN_ENCRYPTION_KEY_VERSION: "v2",
      EBAY_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      EBAY_TOKEN_ENCRYPTION_KEYS_JSON: JSON.stringify({ v2: previous.toString("base64") }),
    } as NodeJS.ProcessEnv)).toThrow("could not be processed")
  })
})
