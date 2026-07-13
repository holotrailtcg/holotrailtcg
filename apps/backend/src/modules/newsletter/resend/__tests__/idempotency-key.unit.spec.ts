import { deriveConfirmationEmailIdempotencyKey } from "../idempotency-key"

describe("deriveConfirmationEmailIdempotencyKey", () => {
  it("is deterministic for the same subscriber and token hash", () => {
    const a = deriveConfirmationEmailIdempotencyKey("nlsub_1", "hash-a")
    const b = deriveConfirmationEmailIdempotencyKey("nlsub_1", "hash-a")
    expect(a).toBe(b)
  })

  it("is stable across a simulated retry (called again with identical inputs)", () => {
    const first = deriveConfirmationEmailIdempotencyKey("nlsub_1", "hash-a")
    const retry = deriveConfirmationEmailIdempotencyKey("nlsub_1", "hash-a")
    expect(retry).toBe(first)
  })

  it("changes after a token rotation (different hash)", () => {
    const first = deriveConfirmationEmailIdempotencyKey("nlsub_1", "hash-a")
    const rotated = deriveConfirmationEmailIdempotencyKey("nlsub_1", "hash-b")
    expect(rotated).not.toBe(first)
  })

  it("differs between subscribers with a coincidentally equal hash", () => {
    const a = deriveConfirmationEmailIdempotencyKey("nlsub_1", "hash-a")
    const b = deriveConfirmationEmailIdempotencyKey("nlsub_2", "hash-a")
    expect(a).not.toBe(b)
  })

  it("never contains the plaintext token or an email address", () => {
    const key = deriveConfirmationEmailIdempotencyKey("nlsub_1", "hash-a")
    expect(key).not.toContain("@")
    expect(key).not.toContain("hash-a")
  })

  it("produces a hex digest within Resend's documented length/format constraints", () => {
    const key = deriveConfirmationEmailIdempotencyKey("nlsub_1", "hash-a")
    expect(key.length).toBeLessThanOrEqual(256)
    expect(key.length).toBeGreaterThan(0)
    expect(key).toMatch(/^[0-9a-f]+$/)
  })

  it("is namespaced (does not equal a bare hash of subscriberId+tokenHash without the namespace)", () => {
    const key = deriveConfirmationEmailIdempotencyKey("nlsub_1", "hash-a")
    const { createHash } = require("node:crypto")
    const unnamespaced = createHash("sha256").update("nlsub_1:hash-a", "utf8").digest("hex")
    expect(key).not.toBe(unnamespaced)
  })
})
