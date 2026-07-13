/**
 * Test-only bypass strategy for reCAPTCHA verification: the preferred
 * design from docs/decisions/0005 is dependency injection of an
 * alternative `RecaptchaVerifier` implementation, not a flag inside
 * `GoogleRecaptchaVerifier` itself. This suite:
 *
 * 1. demonstrates the intended pattern (a fake verifier defined and used
 *    only inside this test file, never exported from `src/`);
 * 2. proves the production verifier has no environment-variable-driven
 *    bypass, including under `NODE_ENV=production`;
 * 3. proves no "magic token string" short-circuits verification.
 */
import { GoogleRecaptchaVerifier, type RecaptchaVerifier } from "../verify"
import type { RecaptchaConfig } from "../config"

const baseConfig: RecaptchaConfig = {
  secretKey: "test-only-secret",
  minScore: 0.5,
  allowedHostnames: null,
  maxTokenAgeSeconds: 120,
}

function fakeFetch(
  impl: (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>
) {
  return jest.fn(impl) as unknown as typeof fetch
}

/**
 * A fake verifier for use in automated tests only. This class lives in a
 * test file, not under `src/modules/newsletter/recaptcha/` — it is not
 * exported anywhere production code could reach it, and a future public
 * route can only obtain it via explicit dependency injection in a test
 * setup, never via configuration.
 */
class FakeRecaptchaVerifier implements RecaptchaVerifier {
  constructor(private readonly result: Awaited<ReturnType<RecaptchaVerifier["verify"]>>) {}
  async verify() {
    return this.result
  }
}

describe("test-only bypass strategy", () => {
  it("allows an automated test to inject a fake verifier that always passes", async () => {
    const fake = new FakeRecaptchaVerifier({ verified: true })
    const result = await fake.verify()
    expect(result).toEqual({ verified: true })
  })

  it("production verifier construction never reads process.env for a bypass", async () => {
    const originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = "production"
    process.env.RECAPTCHA_BYPASS = "true"
    process.env.NEWSLETTER_RECAPTCHA_TEST_BYPASS = "true"

    try {
      const fetchImpl = fakeFetch(async () =>
        ({ ok: true, json: async () => ({ success: false, "error-codes": [] }) })
      )
      const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
      const result = await verifier.verify("any-token")

      // With NODE_ENV=production and env vars that *look* like bypass
      // flags set, the verifier must still make the real provider call
      // and honour its (failing) result — nothing short-circuits.
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ verified: false, reason: "PROVIDER_ERROR" })
    } finally {
      process.env.NODE_ENV = originalNodeEnv
      delete process.env.RECAPTCHA_BYPASS
      delete process.env.NEWSLETTER_RECAPTCHA_TEST_BYPASS
    }
  })

  it("NODE_ENV=production cannot activate a bypass even with no env vars set at all", async () => {
    const originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = "production"

    try {
      const fetchImpl = fakeFetch(async () =>
        ({ ok: true, json: async () => ({ success: true, score: 0.9, action: "newsletter_subscribe", challenge_ts: new Date().toISOString() }) })
      )
      const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
      const result = await verifier.verify("token")

      // The real provider call still happened and its real (passing)
      // result was honoured — production behaviour is identical to any
      // other environment, because the class never branches on NODE_ENV.
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ verified: true })
    } finally {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it("submitting a magic token string does not bypass verification", async () => {
    const magicTokens = ["test-bypass", "always-pass", "RECAPTCHA_BYPASS", "bypass"]
    for (const magicToken of magicTokens) {
      const fetchImpl = fakeFetch(async () =>
        ({ ok: true, json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }) })
      )
      const verifier = new GoogleRecaptchaVerifier(baseConfig, fetchImpl)
      const result = await verifier.verify(magicToken)

      // The "magic" string is sent to Google like any other token and
      // the (failing) provider response is honoured verbatim.
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(result).toEqual({ verified: false, reason: "INVALID_RESPONSE" })
    }
  })
})
