import { generateOpaqueToken, hashToken } from "../lifecycle/token"

describe("generateOpaqueToken", () => {
  it("decodes to at least 32 bytes (256 bits) of entropy", () => {
    const token = generateOpaqueToken()
    const decoded = Buffer.from(token, "base64url")
    expect(decoded.length).toBeGreaterThanOrEqual(32)
  })

  it("is URL-safe (no '+', '/', or '=' characters)", () => {
    const token = generateOpaqueToken()
    expect(token).not.toMatch(/[+/=]/)
  })

  it("generates two different tokens on successive calls", () => {
    const a = generateOpaqueToken()
    const b = generateOpaqueToken()
    expect(a).not.toBe(b)
  })
})

describe("hashToken", () => {
  it("produces a stable result for the same input", () => {
    const token = generateOpaqueToken()
    expect(hashToken(token)).toBe(hashToken(token))
  })

  it("produces a full-length lower-case hex SHA-256 digest", () => {
    const hash = hashToken("fixed-test-token")
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("matches a known SHA-256 test vector", () => {
    // sha256("abc") is a standard published test vector (FIPS 180-4).
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    )
  })

  it("rejects an empty token", () => {
    expect(() => hashToken("")).toThrow()
  })

  it("rejects a non-string token", () => {
    // @ts-expect-error deliberately invalid input
    expect(() => hashToken(undefined)).toThrow()
  })

  it("never stores plaintext alongside the hash (structural check)", () => {
    const token = generateOpaqueToken()
    const hash = hashToken(token)
    expect(hash).not.toContain(token)
  })
})
