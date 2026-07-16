import { assertManagedKey, assertManagedPrefix, MANAGED_FINAL_PREFIX, MANAGED_STAGING_PREFIX } from "../managed-prefixes"

describe("assertManagedPrefix", () => {
  it("accepts the staging prefix", () => {
    expect(assertManagedPrefix(MANAGED_STAGING_PREFIX)).toBe(MANAGED_STAGING_PREFIX)
  })

  it("accepts the final prefix", () => {
    expect(assertManagedPrefix(MANAGED_FINAL_PREFIX)).toBe(MANAGED_FINAL_PREFIX)
  })

  it("rejects a prefix that merely starts with a managed prefix plus extra characters", () => {
    expect(() => assertManagedPrefix(`${MANAGED_STAGING_PREFIX}extra/`)).toThrow(
      /managed R2 prefix/
    )
  })

  it("rejects an unrelated prefix", () => {
    expect(() => assertManagedPrefix("other/")).toThrow(/managed R2 prefix/)
  })

  it("rejects an empty string", () => {
    expect(() => assertManagedPrefix("")).toThrow(/managed R2 prefix/)
  })

  it("rejects a path-traversal attempt", () => {
    expect(() => assertManagedPrefix("../")).toThrow(/managed R2 prefix/)
  })
})

describe("assertManagedKey", () => {
  it("accepts a key under the staging prefix", () => {
    const key = `${MANAGED_STAGING_PREFIX}variant/image/uuid.jpg`
    expect(assertManagedKey(key)).toBe(key)
  })

  it("accepts a key under the final prefix", () => {
    const key = `${MANAGED_FINAL_PREFIX}variant/image/uuid.jpg`
    expect(assertManagedKey(key)).toBe(key)
  })

  it("rejects a key outside both managed prefixes", () => {
    expect(() => assertManagedKey("other/variant/image/uuid.jpg")).toThrow(/managed R2 prefix/)
  })

  it("rejects an empty string", () => {
    expect(() => assertManagedKey("")).toThrow(/managed R2 prefix/)
  })

  it("rejects the exact staging prefix as a key", () => {
    expect(() => assertManagedKey(MANAGED_STAGING_PREFIX)).toThrow(/managed R2 prefix/)
  })

  it("rejects the exact final prefix as a key", () => {
    expect(() => assertManagedKey(MANAGED_FINAL_PREFIX)).toThrow(/managed R2 prefix/)
  })

  it("accepts a one-character descendant of the final prefix", () => {
    const key = `${MANAGED_FINAL_PREFIX}a`
    expect(assertManagedKey(key)).toBe(key)
  })

  it("accepts a normal generated key", () => {
    const key = `${MANAGED_FINAL_PREFIX}variant-id/image-id/${"a".repeat(8)}.jpg`
    expect(assertManagedKey(key)).toBe(key)
  })

  it("accepts a nested valid descendant under the staging prefix", () => {
    const key = `${MANAGED_STAGING_PREFIX}variant-id/image-id/nested/uuid.jpg`
    expect(assertManagedKey(key)).toBe(key)
  })

  it("rejects a similar-looking prefix that is not one of the two managed prefixes", () => {
    expect(() => assertManagedKey("card-images-other/uuid.jpg")).toThrow(/managed R2 prefix/)
    expect(() => assertManagedKey("staging/card-images-extra/uuid.jpg")).toThrow(/managed R2 prefix/)
  })

  it("rejects a whitespace-only suffix after the prefix", () => {
    expect(() => assertManagedKey(`${MANAGED_FINAL_PREFIX}   `)).toThrow(/managed R2 prefix/)
  })

  it("never includes the supplied key in the thrown error message", () => {
    const secretLookingKey = "other/super-secret-path/uuid.jpg"
    try {
      assertManagedKey(secretLookingKey)
      throw new Error("expected assertManagedKey to throw")
    } catch (error) {
      expect((error as Error).message).not.toContain(secretLookingKey)
    }
  })
})
