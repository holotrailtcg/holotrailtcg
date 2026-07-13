import type { RecaptchaConfig } from "./config"

/** Google's official verification endpoint. */
const SITEVERIFY_ENDPOINT = "https://www.google.com/recaptcha/api/siteverify"

/**
 * The only action this backend ever accepts. Not configurable per call —
 * accepting a caller-supplied "required action" would let a compromised
 * caller widen what counts as valid, which defeats the point of checking
 * it at all.
 */
const REQUIRED_ACTION = "newsletter_subscribe"

/** Bounded timeout for the outbound `siteverify` call; no retry on timeout. */
const VERIFY_TIMEOUT_MS = 5_000

/** Small clock-skew allowance for a challenge timestamp reported as being in the future. */
const CHALLENGE_FUTURE_TOLERANCE_SECONDS = 5

export type RecaptchaVerificationReason =
  | "MISSING_TOKEN"
  | "PROVIDER_ERROR"
  | "INVALID_RESPONSE"
  | "ACTION_MISMATCH"
  | "LOW_SCORE"
  | "HOSTNAME_MISMATCH"
  | "EXPIRED_TOKEN"
  | "MISCONFIGURED"

export type RecaptchaVerificationResult =
  | { verified: true }
  | { verified: false; reason: RecaptchaVerificationReason }

/**
 * The verification boundary a future public route depends on. Production
 * code depends on this interface, not on `GoogleRecaptchaVerifier`
 * directly, so automated tests can inject an alternative implementation
 * without any bypass branch existing inside the production verifier
 * itself.
 */
export interface RecaptchaVerifier {
  verify(token: string): Promise<RecaptchaVerificationResult>
}

type FetchLike = typeof fetch

interface SiteverifyRawResponse {
  success?: unknown
  score?: unknown
  action?: unknown
  hostname?: unknown
  challenge_ts?: unknown
  "error-codes"?: unknown
}

const MISCONFIGURED_ERROR_CODES = new Set(["missing-input-secret", "invalid-input-secret"])
const EXPIRED_ERROR_CODES = new Set(["timeout-or-duplicate"])
const MISSING_TOKEN_ERROR_CODES = new Set(["missing-input-response"])
const INVALID_RESPONSE_ERROR_CODES = new Set(["invalid-input-response", "bad-request"])

function reasonForErrorCodes(rawCodes: unknown): RecaptchaVerificationReason {
  const codes = Array.isArray(rawCodes) ? rawCodes.map((code) => String(code)) : []

  if (codes.some((code) => MISCONFIGURED_ERROR_CODES.has(code))) {
    return "MISCONFIGURED"
  }
  if (codes.some((code) => EXPIRED_ERROR_CODES.has(code))) {
    return "EXPIRED_TOKEN"
  }
  if (codes.some((code) => MISSING_TOKEN_ERROR_CODES.has(code))) {
    return "MISSING_TOKEN"
  }
  if (codes.some((code) => INVALID_RESPONSE_ERROR_CODES.has(code))) {
    return "INVALID_RESPONSE"
  }
  return "PROVIDER_ERROR"
}

/**
 * Production reCAPTCHA v3 verifier. Talks to Google's `siteverify`
 * endpoint over `fetch` (no new HTTP dependency) with a bounded timeout,
 * and never sends `remoteip` — the project's "avoid raw-IP handling where
 * practical" rule outweighs the marginal signal `remoteip` would add here.
 *
 * Deliberately has no bypass branch of any kind: it does not read
 * `process.env`, does not special-case any token value, and does not
 * consult `NODE_ENV`. Whatever behaviour differs between production and
 * tests must come from the caller injecting a different `RecaptchaVerifier`
 * implementation, not from a flag inside this class.
 */
export class GoogleRecaptchaVerifier implements RecaptchaVerifier {
  constructor(
    private readonly config: RecaptchaConfig,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async verify(token: string): Promise<RecaptchaVerificationResult> {
    if (typeof token !== "string" || token.trim().length === 0) {
      return { verified: false, reason: "MISSING_TOKEN" }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)

    let response: Response
    try {
      response = await this.fetchImpl(SITEVERIFY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: this.config.secretKey,
          response: token,
        }).toString(),
        signal: controller.signal,
      })
    } catch {
      return { verified: false, reason: "PROVIDER_ERROR" }
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      return { verified: false, reason: "PROVIDER_ERROR" }
    }

    let body: SiteverifyRawResponse
    try {
      body = (await response.json()) as SiteverifyRawResponse
    } catch {
      return { verified: false, reason: "INVALID_RESPONSE" }
    }

    if (typeof body !== "object" || body === null) {
      return { verified: false, reason: "INVALID_RESPONSE" }
    }

    if (body.success !== true) {
      return { verified: false, reason: reasonForErrorCodes(body["error-codes"]) }
    }

    if (body.action !== REQUIRED_ACTION) {
      return { verified: false, reason: "ACTION_MISMATCH" }
    }

    if (
      typeof body.score !== "number" ||
      !Number.isFinite(body.score) ||
      body.score < 0 ||
      body.score > 1
    ) {
      return { verified: false, reason: "INVALID_RESPONSE" }
    }
    if (body.score < this.config.minScore) {
      return { verified: false, reason: "LOW_SCORE" }
    }

    if (this.config.allowedHostnames) {
      if (
        typeof body.hostname !== "string" ||
        !this.config.allowedHostnames.includes(body.hostname)
      ) {
        return { verified: false, reason: "HOSTNAME_MISMATCH" }
      }
    }

    if (typeof body.challenge_ts !== "string") {
      // A missing challenge timestamp must not be treated as valid — it
      // prevents age verification entirely, so it fails closed the same
      // way an expired token would.
      return { verified: false, reason: "EXPIRED_TOKEN" }
    }
    const challengeTimeMs = Date.parse(body.challenge_ts)
    if (Number.isNaN(challengeTimeMs)) {
      return { verified: false, reason: "EXPIRED_TOKEN" }
    }
    const ageSeconds = (Date.now() - challengeTimeMs) / 1000
    if (ageSeconds > this.config.maxTokenAgeSeconds) {
      return { verified: false, reason: "EXPIRED_TOKEN" }
    }
    if (ageSeconds < -CHALLENGE_FUTURE_TOLERANCE_SECONDS) {
      return { verified: false, reason: "EXPIRED_TOKEN" }
    }

    return { verified: true }
  }
}
