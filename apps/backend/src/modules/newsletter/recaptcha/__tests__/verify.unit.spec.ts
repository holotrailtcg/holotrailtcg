import { GoogleRecaptchaVerifier } from "../verify"
import type { RecaptchaConfig } from "../config"

const baseConfig: RecaptchaConfig = {
  secretKey: "test-only-secret",
  minScore: 0.5,
  allowedHostnames: null,
  maxTokenAgeSeconds: 120,
}

const nowIso = () => new Date().toISOString()

function fakeFetch(
  impl: (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>
) {
  return jest.fn(impl) as unknown as typeof fetch
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body }
}

describe("GoogleRecaptchaVerifier — valid response", () => {
  it("verifies a valid response", async () => {
    const fetchImpl = fakeFetch(async () =>
      jsonResponse({
        success: true,
        score: 0.9,
        action: "newsletter_subscribe",
        challenge_ts: nowIso(),
      })
    )
    const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
    const result = await verifier.verify("a-real-looking-token")
    expect(result).toEqual({ verified: true })
  })

  it("accepts a score exactly equal to the configured minimum", async () => {
    const fetchImpl = fakeFetch(async () =>
      jsonResponse({
        success: true,
        score: 0.5,
        action: "newsletter_subscribe",
        challenge_ts: nowIso(),
      })
    )
    const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
    const result = await verifier.verify("token")
    expect(result).toEqual({ verified: true })
  })
})

describe("GoogleRecaptchaVerifier — rejections", () => {
  it("rejects a missing token without calling the provider", async () => {
    const fetchImpl = fakeFetch(async () => jsonResponse({ success: true }))
    const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
    const result = await verifier.verify("")
    expect(result).toEqual({ verified: false, reason: "MISSING_TOKEN" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects when the provider reports success: false", async () => {
    const fetchImpl = fakeFetch(async () =>
      jsonResponse({ success: false, "error-codes": ["invalid-input-response"] })
    )
    const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
    const result = await verifier.verify("token")
    expect(result).toEqual({ verified: false, reason: "INVALID_RESPONSE" })
  })

  it("rejects on an action mismatch even with a high score", async () => {
    const fetchImpl = fakeFetch(async () =>
      jsonResponse({
        success: true,
        score: 0.99,
        action: "some_other_action",
        challenge_ts: nowIso(),
      })
    )
    const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
    const result = await verifier.verify("token")
    expect(result).toEqual({ verified: false, reason: "ACTION_MISMATCH" })
  })

  it("rejects a score below the configured minimum", async () => {
    const fetchImpl = fakeFetch(async () =>
      jsonResponse({
        success: true,
        score: 0.1,
        action: "newsletter_subscribe",
        challenge_ts: nowIso(),
      })
    )
    const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
    const result = await verifier.verify("token")
    expect(result).toEqual({ verified: false, reason: "LOW_SCORE" })
  })

  it("accepts an allowed hostname", async () => {
    const config: RecaptchaConfig = { ...baseConfig, allowedHostnames: ["holotrailtcg.com"] }
    const fetchImpl = fakeFetch(async () =>
      jsonResponse({
        success: true,
        score: 0.9,
        action: "newsletter_subscribe",
        hostname: "holotrailtcg.com",
        challenge_ts: nowIso(),
      })
    )
    const verifier = new GoogleRecaptchaVerifier(config, fetchImpl)
    const result = await verifier.verify("token")
    expect(result).toEqual({ verified: true })
  })

  it("rejects a disallowed hostname", async () => {
    const config: RecaptchaConfig = { ...baseConfig, allowedHostnames: ["holotrailtcg.com"] }
    const fetchImpl = fakeFetch(async () =>
      jsonResponse({
        success: true,
        score: 0.9,
        action: "newsletter_subscribe",
        hostname: "evil.example.com",
        challenge_ts: nowIso(),
      })
    )
    const verifier = new GoogleRecaptchaVerifier(config, fetchImpl)
    const result = await verifier.verify("token")
    expect(result).toEqual({ verified: false, reason: "HOSTNAME_MISMATCH" })
  })

  it("rejects a malformed challenge timestamp", async () => {
    const fetchImpl = fakeFetch(async () =>
      jsonResponse({
        success: true,
        score: 0.9,
        action: "newsletter_subscribe",
        challenge_ts: "not-a-date",
      })
    )
    const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
    const result = await verifier.verify("token")
    expect(result).toEqual({ verified: false, reason: "EXPIRED_TOKEN" })
  })

  it("rejects an expired challenge timestamp", async () => {
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const fetchImpl = fakeFetch(async () =>
      jsonResponse({
        success: true,
        score: 0.9,
        action: "newsletter_subscribe",
        challenge_ts: old,
      })
    )
    const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
    const result = await verifier.verify("token")
    expect(result).toEqual({ verified: false, reason: "EXPIRED_TOKEN" })
  })

  it("rejects a challenge timestamp too far in the future", async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    const fetchImpl = fakeFetch(async () =>
      jsonResponse({
        success: true,
        score: 0.9,
        action: "newsletter_subscribe",
        challenge_ts: future,
      })
    )
    const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
    const result = await verifier.verify("token")
    expect(result).toEqual({ verified: false, reason: "EXPIRED_TOKEN" })
  })
})

describe("GoogleRecaptchaVerifier — transport failures", () => {
  it("fails closed on a timeout / abort", async () => {
    const fetchImpl = fakeFetch(async () => {
      throw new DOMException("The operation was aborted", "AbortError")
    })
    const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
    const result = await verifier.verify("token")
    expect(result).toEqual({ verified: false, reason: "PROVIDER_ERROR" })
  })

  it("fails closed on a network failure", async () => {
    const fetchImpl = fakeFetch(async () => {
      throw new Error("network down")
    })
    const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
    const result = await verifier.verify("token")
    expect(result).toEqual({ verified: false, reason: "PROVIDER_ERROR" })
  })

  it("fails closed on a non-2xx response", async () => {
    const fetchImpl = fakeFetch(async () => jsonResponse({}, false))
    const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
    const result = await verifier.verify("token")
    expect(result).toEqual({ verified: false, reason: "PROVIDER_ERROR" })
  })

  it("fails closed on malformed JSON", async () => {
    const fetchImpl = fakeFetch(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token")
      },
    }))
    const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
    const result = await verifier.verify("token")
    expect(result).toEqual({ verified: false, reason: "INVALID_RESPONSE" })
  })

  it("maps a misconfigured-secret provider error code", async () => {
    const fetchImpl = fakeFetch(async () =>
      jsonResponse({ success: false, "error-codes": ["invalid-input-secret"] })
    )
    const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
    const result = await verifier.verify("token")
    expect(result).toEqual({ verified: false, reason: "MISCONFIGURED" })
  })

  it("maps a timeout-or-duplicate provider error code to EXPIRED_TOKEN", async () => {
    const fetchImpl = fakeFetch(async () =>
      jsonResponse({ success: false, "error-codes": ["timeout-or-duplicate"] })
    )
    const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
    const result = await verifier.verify("token")
    expect(result).toEqual({ verified: false, reason: "EXPIRED_TOKEN" })
  })

  it("falls back to PROVIDER_ERROR for an unrecognised provider error code", async () => {
    const fetchImpl = fakeFetch(async () =>
      jsonResponse({ success: false, "error-codes": ["something-new-google-added"] })
    )
    const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
    const result = await verifier.verify("token")
    expect(result).toEqual({ verified: false, reason: "PROVIDER_ERROR" })
  })
})

describe("GoogleRecaptchaVerifier — logging and secrecy", () => {
  it("never includes the token in the outbound URL (it is sent as a POST body)", async () => {
    let capturedUrl = ""
    const fetchImpl = fakeFetch(async (url) => {
      capturedUrl = url
      return jsonResponse({
        success: true,
        score: 0.9,
        action: "newsletter_subscribe",
        challenge_ts: nowIso(),
      })
    })
    const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
    await verifier.verify("super-secret-token-value")
    expect(capturedUrl).not.toContain("super-secret-token-value")
  })

  it("never retries the same token after a failed verification", async () => {
    const fetchImpl = fakeFetch(async () => jsonResponse({ success: false, "error-codes": [] }))
    const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
    await verifier.verify("token")
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("does not throw or leak the secret when verification fails", async () => {
    const fetchImpl = fakeFetch(async () => jsonResponse({ success: false, "error-codes": [] }))
    const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
    const result = await verifier.verify("token")
    expect(JSON.stringify(result)).not.toContain(baseConfig.secretKey)
  })
})
