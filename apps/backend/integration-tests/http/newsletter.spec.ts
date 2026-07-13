import { NEWSLETTER_MODULE } from "../../src/modules/newsletter"
import type NewsletterModuleService from "../../src/modules/newsletter/service"
import {
  bootstrapNewsletterHttpTestApp,
  nextTestClientAddress,
  TEST_RATE_LIMIT_MAX_REQUESTS,
  type NewsletterHttpTestApp,
} from "./support/bootstrap"

jest.setTimeout(180_000)

/**
 * All Stage 2C.6 public newsletter route HTTP integration tests live in
 * this single file, sharing exactly one `bootstrapNewsletterHttpTestApp()`
 * call (top-level `beforeAll`/`afterAll`, outside every `describe`).
 *
 * This is a hard requirement, not a style choice: `startApp()` boots the
 * real Medusa app via the official loaders, and Medusa's module registry
 * (`MedusaModule`) is process-wide static state. A second full app boot in
 * the same Jest worker process throws `Method Map.prototype.set called on
 * incompatible receiver` while loading the Notification module — the exact
 * class of failure Stage 2C.3 documented for two module-test bootstraps in
 * one worker (docs/decisions/0005-newsletter-backend-design.md), confirmed
 * directly here across separate `*.spec.ts` files (Jest's `--runInBand`
 * runs every matched file in one worker process, not one process per
 * file). Splitting these tests into `newsletter-subscribe.spec.ts`,
 * `newsletter-confirm.spec.ts`, etc. was tried first and reverted for
 * exactly this reason — see the Stage 2C.6 notes in the design doc.
 */

const ACCEPTED_BODY = {
  success: true,
  message: "If the details are valid, check your inbox for a confirmation email.",
}

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
}

function validSubmission(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Ash",
    email: uniqueEmail("subscribe"),
    consent: true,
    recaptchaToken: "valid-token",
    countryCode: "gb",
    ...overrides,
  }
}

let app: NewsletterHttpTestApp
let store: NewsletterModuleService

beforeAll(async () => {
  app = await bootstrapNewsletterHttpTestApp()
  store = app.container.resolve<NewsletterModuleService>(NEWSLETTER_MODULE)
})

afterAll(async () => {
  await app.close()
})

beforeEach(() => {
  app.recaptcha.programme("verified")
  app.emailSender.programme("SENT")
})

describe("POST /store/newsletter/subscribe", () => {
  it("accepts a valid new signup, returns the generic response, and creates a PENDING subscriber", async () => {
    const submission = validSubmission()
    const sendsBefore = app.emailSender.sends.length

    const res = await app.postSubscribe(submission)

    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toEqual(ACCEPTED_BODY)
    expect(Object.keys(body).sort()).toEqual(["message", "success"])

    const subscriber = await store.retrieveSubscriberByNormalisedEmail(
      submission.email.toLowerCase()
    )
    expect(subscriber).not.toBeNull()
    expect(subscriber?.status).toBe("PENDING")
    expect(subscriber?.first_purchase_discount_eligible).toBe(false)
    expect(app.emailSender.sends.length).toBe(sendsBefore + 1)
  })

  it("keeps a duplicate pending signup generic and does not disclose state", async () => {
    const submission = validSubmission()
    const clientAddress = nextTestClientAddress()

    const first = await app.postSubscribe(submission, clientAddress)
    expect(first.status).toBe(202)

    const second = await app.postSubscribe(submission, nextTestClientAddress())
    expect(second.status).toBe(202)
    expect(await second.json()).toEqual(ACCEPTED_BODY)
  })

  it("keeps a confirmed duplicate generic and sends no further email", async () => {
    const submission = validSubmission()
    await app.postSubscribe(submission)

    const subscriber = await store.retrieveSubscriberByNormalisedEmail(
      submission.email.toLowerCase()
    )
    expect(subscriber).not.toBeNull()

    const pending = await store.listSubscribers({ id: subscriber!.id })
    expect(pending[0].confirmation_token_hash).not.toBeNull()

    // Use the real confirm route with the token captured from the fake
    // sender's rendered email URL — the plaintext token never appears in
    // any HTTP response, by design, so this is the only place a test can
    // observe it.
    const sendPayload = app.emailSender.sends.at(-1)
    const url = new URL(sendPayload!.rendered.html.match(/href="([^"]+)"/)![1])
    const token = url.searchParams.get("token")!
    const confirmRes = await app.getConfirm(token)
    expect((await confirmRes.json()).result).toBe("confirmed")

    const sendsBeforeSecondSubscribe = app.emailSender.sends.length
    const second = await app.postSubscribe(submission)
    expect(second.status).toBe(202)
    expect(await second.json()).toEqual(ACCEPTED_BODY)
    expect(app.emailSender.sends.length).toBe(sendsBeforeSecondSubscribe)

    const confirmed = await store.retrieveSubscriberByNormalisedEmail(
      submission.email.toLowerCase()
    )
    expect(confirmed?.status).toBe("CONFIRMED")
  })

  it("turns an unsubscribed resubscription back into PENDING", async () => {
    // Arranges the UNSUBSCRIBED precondition by calling the lifecycle
    // service directly (not via HTTP) — the plaintext confirmation/
    // unsubscribe tokens are deliberately never present in any HTTP
    // response, so a test cannot recover them from the confirm/unsubscribe
    // routes' own output. Those routes are exercised end-to-end in their
    // own describe blocks below; this test is only about what
    // `prepareSubscription` (invoked by this route) does with an
    // already-UNSUBSCRIBED row.
    const submission = validSubmission()
    const prepared = await store.prepareSubscription({
      firstName: submission.firstName,
      email: submission.email,
      consentTextVersion: "http-test-v1",
      source: "http-test",
    })
    expect(prepared.outcome).toBe("PENDING_CREATED")
    const confirmed = await store.confirmSubscription(
      (prepared as { confirmationToken: string }).confirmationToken
    )
    expect(confirmed.outcome).toBe("CONFIRMED")
    const unsubscribed = await store.unsubscribeSubscription(
      (confirmed as { unsubscribeToken: string }).unsubscribeToken
    )
    expect(unsubscribed.outcome).toBe("UNSUBSCRIBED")

    const sendsBefore = app.emailSender.sends.length
    const res = await app.postSubscribe(submission)
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual(ACCEPTED_BODY)
    expect(app.emailSender.sends.length).toBe(sendsBefore + 1)

    const subscriber = await store.retrieveSubscriberByNormalisedEmail(
      submission.email.toLowerCase()
    )
    expect(subscriber?.status).toBe("PENDING")
    expect(subscriber?.first_purchase_discount_eligible).toBe(false)
  })

  it("strictly requires consent to be the boolean true", async () => {
    for (const consent of [false, "true", "false", 1, 0, "", [], {}]) {
      const res = await app.postSubscribe(validSubmission({ consent }))
      expect(res.status).toBe(400)
    }
  })

  it("rejects a missing consent field", async () => {
    const submission = validSubmission()
    delete (submission as Record<string, unknown>).consent
    const res = await app.postSubscribe(submission)
    expect(res.status).toBe(400)
  })

  it("rejects an invalid email address", async () => {
    const res = await app.postSubscribe(validSubmission({ email: "not-an-email" }))
    expect(res.status).toBe(400)
  })

  it("rejects an overlong first name", async () => {
    const res = await app.postSubscribe(validSubmission({ firstName: "a".repeat(101) }))
    expect(res.status).toBe(400)
  })

  it("rejects a malformed country code", async () => {
    const res = await app.postSubscribe(validSubmission({ countryCode: "gbr" }))
    expect(res.status).toBe(400)
  })

  it("rejects a missing reCAPTCHA token", async () => {
    const submission = validSubmission()
    delete (submission as Record<string, unknown>).recaptchaToken
    const res = await app.postSubscribe(submission)
    expect(res.status).toBe(400)
  })

  it("silently accepts a filled honeypot without creating a subscriber or sending email", async () => {
    const submission = validSubmission({ honeypot: "i-am-a-bot" })
    const sendsBefore = app.emailSender.sends.length
    const recaptchaCallsBefore = app.recaptcha.calls.length

    const res = await app.postSubscribe(submission)

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual(ACCEPTED_BODY)
    expect(app.emailSender.sends.length).toBe(sendsBefore)
    expect(app.recaptcha.calls.length).toBe(recaptchaCallsBefore)

    const subscriber = await store.retrieveSubscriberByNormalisedEmail(
      submission.email.toLowerCase()
    )
    expect(subscriber).toBeNull()
  })

  it("denies a request once the rate limit is exceeded, without touching subscriber state", async () => {
    const clientAddress = nextTestClientAddress()

    for (let i = 0; i < TEST_RATE_LIMIT_MAX_REQUESTS; i += 1) {
      const res = await app.postSubscribe(validSubmission(), clientAddress)
      expect(res.status).toBe(202)
    }

    const overLimitSubmission = validSubmission()
    const res = await app.postSubscribe(overLimitSubmission, clientAddress)
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).not.toBeNull()
    const body = await res.json()
    expect(body.success).toBe(false)

    const subscriber = await store.retrieveSubscriberByNormalisedEmail(
      overLimitSubmission.email.toLowerCase()
    )
    expect(subscriber).toBeNull()
  })

  it("fails closed on reCAPTCHA provider unavailability without touching subscriber state", async () => {
    app.recaptcha.programme("PROVIDER_ERROR")
    const submission = validSubmission()

    const res = await app.postSubscribe(submission)
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(JSON.stringify(body)).not.toMatch(/PROVIDER_ERROR/)

    const subscriber = await store.retrieveSubscriberByNormalisedEmail(
      submission.email.toLowerCase()
    )
    expect(subscriber).toBeNull()
  })

  it("rejects an action mismatch without touching subscriber state", async () => {
    app.recaptcha.programme("ACTION_MISMATCH")
    const submission = validSubmission()
    const res = await app.postSubscribe(submission)
    expect(res.status).toBe(403)
    const subscriber = await store.retrieveSubscriberByNormalisedEmail(
      submission.email.toLowerCase()
    )
    expect(subscriber).toBeNull()
  })

  it("rejects a low reCAPTCHA score without touching subscriber state", async () => {
    app.recaptcha.programme("LOW_SCORE")
    const submission = validSubmission()
    const res = await app.postSubscribe(submission)
    expect(res.status).toBe(403)
    const subscriber = await store.retrieveSubscriberByNormalisedEmail(
      submission.email.toLowerCase()
    )
    expect(subscriber).toBeNull()
  })

  it("never confirms a subscriber when Resend definitively fails", async () => {
    app.emailSender.programme("FAILED")
    const submission = validSubmission()

    const res = await app.postSubscribe(submission)
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual(ACCEPTED_BODY)

    const subscriber = await store.retrieveSubscriberByNormalisedEmail(
      submission.email.toLowerCase()
    )
    expect(subscriber?.status).toBe("PENDING")
    expect(subscriber?.confirmation_send_state).toBe("FAILED")
  })

  it("does not retry an ambiguous Resend outcome within one request", async () => {
    app.emailSender.programme("AMBIGUOUS")
    const submission = validSubmission()
    const sendsBefore = app.emailSender.sends.length

    const res = await app.postSubscribe(submission)
    expect(res.status).toBe(202)
    expect(app.emailSender.sends.length).toBe(sendsBefore + 1)

    const subscriber = await store.retrieveSubscriberByNormalisedEmail(
      submission.email.toLowerCase()
    )
    expect(subscriber?.status).toBe("PENDING")
    expect(subscriber?.confirmation_send_state).toBe("UNKNOWN")
  })

  it("never returns provider, subscriber, or token details in the response body", async () => {
    const submission = validSubmission()
    const res = await app.postSubscribe(submission)
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(["message", "success"])
    expect(JSON.stringify(body)).not.toContain(submission.email)
    expect(JSON.stringify(body)).not.toContain(submission.firstName)
    expect(JSON.stringify(body)).not.toMatch(/nlsub|fake-provider-message-id/)
  })
})

describe("POST /store/newsletter/subscribe concurrency", () => {
  it("resolves two concurrent identical first signups to exactly one PENDING subscriber and one email reservation", async () => {
    const submission = validSubmission()

    const [first, second] = await Promise.all([
      app.postSubscribe(submission, nextTestClientAddress()),
      app.postSubscribe(submission, nextTestClientAddress()),
    ])

    expect(first.status).toBe(202)
    expect(second.status).toBe(202)
    expect(await first.json()).toEqual(ACCEPTED_BODY)
    expect(await second.json()).toEqual(ACCEPTED_BODY)

    const matches = await store.listSubscribers({
      normalised_email: submission.email.toLowerCase(),
    })
    expect(matches).toHaveLength(1)
    expect(matches[0].status).toBe("PENDING")

    const sendsForThisSubscriber = app.emailSender.sends.filter(
      (send) => send.toEmail === submission.email
    )
    expect(sendsForThisSubscriber).toHaveLength(1)
  })

  it("keeps rate-limit bucket increments atomic under concurrent requests from the same address", async () => {
    const clientAddress = nextTestClientAddress()

    const responses = await Promise.all(
      Array.from({ length: TEST_RATE_LIMIT_MAX_REQUESTS + 3 }, () =>
        app.postSubscribe(validSubmission(), clientAddress)
      )
    )

    const accepted = responses.filter((res) => res.status === 202)
    const denied = responses.filter((res) => res.status === 429)

    expect(accepted.length).toBe(TEST_RATE_LIMIT_MAX_REQUESTS)
    expect(denied.length).toBe(3)
  })
})

/**
 * `confirmSubscription`'s expiry check uses `Date.now()` internally (not an
 * injectable clock), so genuinely exercising an *expired* token would
 * require waiting out a real TTL. That mechanism (expired vs. arbitrary
 * invalid token both resolving to the same `INVALID_OR_EXPIRED` internal
 * outcome) is already covered directly against the module service in
 * `src/modules/newsletter/__tests__/newsletter-module.spec.ts` (Stage
 * 2C.3). This suite instead proves the *route*-level concern: that
 * `INVALID_OR_EXPIRED` — however it arose — maps to the public
 * `invalid_or_expired` code and never distinguishes the two cases, using an
 * arbitrary token as the practical stand-in for both.
 */
describe("GET /store/newsletter/confirm", () => {
  async function createPendingSubscriberWithToken(): Promise<{
    email: string
    confirmationToken: string
  }> {
    const email = uniqueEmail("confirm")
    const prepared = await store.prepareSubscription({
      firstName: "Ash",
      email,
      consentTextVersion: "http-test-v1",
      source: "http-test",
    })
    if (prepared.outcome !== "PENDING_CREATED") {
      throw new Error("expected PENDING_CREATED")
    }
    return { email, confirmationToken: prepared.confirmationToken }
  }

  it("confirms a valid token and sets Cache-Control: no-store", async () => {
    const { email, confirmationToken } = await createPendingSubscriberWithToken()

    const res = await app.getConfirm(confirmationToken)
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(res.headers.get("Pragma")).toBe("no-cache")
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer")

    const body = await res.json()
    expect(body).toEqual({ result: "confirmed" })
    expect(Object.keys(body)).toEqual(["result"])

    const subscriber = await store.retrieveSubscriberByNormalisedEmail(email.toLowerCase())
    expect(subscriber?.status).toBe("CONFIRMED")
    expect(subscriber?.first_purchase_discount_eligible).toBe(true)
  })

  it("returns already_confirmed for a repeated confirmation of the same token", async () => {
    const { confirmationToken } = await createPendingSubscriberWithToken()

    const first = await app.getConfirm(confirmationToken)
    expect((await first.json()).result).toBe("confirmed")

    const second = await app.getConfirm(confirmationToken)
    expect(second.status).toBe(200)
    const body = await second.json()
    expect(body).toEqual({ result: "already_confirmed" })
  })

  it("returns invalid_or_expired for an arbitrary token, never leaking why", async () => {
    const res = await app.getConfirm("this-token-was-never-issued-by-the-server")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ result: "invalid_or_expired" })
  })

  it("safely rejects a malformed token shape without querying the lifecycle", async () => {
    const res = await app.getConfirm("not a valid base64url token!!")
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toEqual({ result: "invalid_or_expired" })
  })

  it("never returns subscriber data or the token itself in the response body", async () => {
    const { confirmationToken } = await createPendingSubscriberWithToken()
    const res = await app.getConfirm(confirmationToken)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain(confirmationToken)
    expect(Object.keys(body)).toEqual(["result"])
  })
})

describe("GET /store/newsletter/unsubscribe", () => {
  async function createConfirmedSubscriberWithUnsubscribeToken(): Promise<{
    email: string
    unsubscribeToken: string
  }> {
    const email = uniqueEmail("unsubscribe")
    const prepared = await store.prepareSubscription({
      firstName: "Ash",
      email,
      consentTextVersion: "http-test-v1",
      source: "http-test",
    })
    if (prepared.outcome !== "PENDING_CREATED") {
      throw new Error("expected PENDING_CREATED")
    }
    const confirmed = await store.confirmSubscription(prepared.confirmationToken)
    if (confirmed.outcome !== "CONFIRMED") {
      throw new Error("expected CONFIRMED")
    }
    return { email, unsubscribeToken: confirmed.unsubscribeToken }
  }

  it("unsubscribes a valid token, clears eligibility, and sets cache-protection headers", async () => {
    const { email, unsubscribeToken } = await createConfirmedSubscriberWithUnsubscribeToken()

    const res = await app.getUnsubscribe(unsubscribeToken)
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(res.headers.get("Pragma")).toBe("no-cache")
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer")

    const body = await res.json()
    expect(body).toEqual({ result: "unsubscribed" })
    expect(Object.keys(body)).toEqual(["result"])

    const subscriber = await store.retrieveSubscriberByNormalisedEmail(email.toLowerCase())
    expect(subscriber?.status).toBe("UNSUBSCRIBED")
    expect(subscriber?.first_purchase_discount_eligible).toBe(false)
  })

  it("returns already_unsubscribed for a repeated unsubscribe and preserves the original unsubscribed_at", async () => {
    const { email, unsubscribeToken } = await createConfirmedSubscriberWithUnsubscribeToken()

    const first = await app.getUnsubscribe(unsubscribeToken)
    expect((await first.json()).result).toBe("unsubscribed")
    const afterFirst = await store.retrieveSubscriberByNormalisedEmail(email.toLowerCase())
    const firstUnsubscribedAt = afterFirst?.unsubscribed_at

    const second = await app.getUnsubscribe(unsubscribeToken)
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ result: "already_unsubscribed" })

    const afterSecond = await store.retrieveSubscriberByNormalisedEmail(email.toLowerCase())
    expect(afterSecond?.unsubscribed_at?.getTime()).toBe(firstUnsubscribedAt?.getTime())
  })

  it("returns invalid for an arbitrary token", async () => {
    const res = await app.getUnsubscribe("this-token-was-never-issued-by-the-server")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: "invalid" })
  })

  it("safely rejects a malformed token shape", async () => {
    const res = await app.getUnsubscribe("not a valid token!!")
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ result: "invalid" })
  })

  it("never sends an email and never returns subscriber data or the token itself", async () => {
    const { unsubscribeToken } = await createConfirmedSubscriberWithUnsubscribeToken()
    const sendsBefore = app.emailSender.sends.length

    const res = await app.getUnsubscribe(unsubscribeToken)
    const body = await res.json()

    expect(app.emailSender.sends.length).toBe(sendsBefore)
    expect(JSON.stringify(body)).not.toContain(unsubscribeToken)
    expect(Object.keys(body)).toEqual(["result"])
  })
})

/**
 * Explicitly compares the `POST /store/newsletter/subscribe` response
 * across every subscriber-state outcome the route can reach — new,
 * already-pending, already-confirmed, and unsubscribed-resubscribing — plus
 * the honeypot-triggered path. Every one must be byte-identical, since the
 * whole point of the generic response is that a caller cannot distinguish
 * which internal outcome occurred.
 */
describe("newsletter subscribe response consistency", () => {
  it("returns the identical response body for new, pending, confirmed, and resubscribing-unsubscribed states", async () => {
    const newSubmission = validSubmission()
    const newRes = await app.postSubscribe(newSubmission, nextTestClientAddress())

    const pendingRes = await app.postSubscribe(newSubmission, nextTestClientAddress())

    const confirmedSubmission = validSubmission()
    const confirmedPrepared = await store.prepareSubscription({
      firstName: confirmedSubmission.firstName,
      email: confirmedSubmission.email,
      consentTextVersion: "http-test-v1",
      source: "http-test",
    })
    if (confirmedPrepared.outcome !== "PENDING_CREATED") {
      throw new Error("expected PENDING_CREATED")
    }
    await store.confirmSubscription(confirmedPrepared.confirmationToken)
    const confirmedRes = await app.postSubscribe(confirmedSubmission, nextTestClientAddress())

    const resubscribeSubmission = validSubmission()
    const resubscribePrepared = await store.prepareSubscription({
      firstName: resubscribeSubmission.firstName,
      email: resubscribeSubmission.email,
      consentTextVersion: "http-test-v1",
      source: "http-test",
    })
    if (resubscribePrepared.outcome !== "PENDING_CREATED") {
      throw new Error("expected PENDING_CREATED")
    }
    const resubscribeConfirmed = await store.confirmSubscription(
      resubscribePrepared.confirmationToken
    )
    if (resubscribeConfirmed.outcome !== "CONFIRMED") {
      throw new Error("expected CONFIRMED")
    }
    await store.unsubscribeSubscription(resubscribeConfirmed.unsubscribeToken)
    const resubscribeRes = await app.postSubscribe(resubscribeSubmission, nextTestClientAddress())

    const responses = [newRes, pendingRes, confirmedRes, resubscribeRes]
    for (const res of responses) {
      expect(res.status).toBe(202)
    }

    const bodies = await Promise.all(responses.map((res) => res.json()))
    for (const body of bodies) {
      expect(body).toEqual(ACCEPTED_BODY)
    }
  })

  it("returns the same generic body shape for a honeypot-triggered request as for a genuine success", async () => {
    const genuineRes = await app.postSubscribe(validSubmission(), nextTestClientAddress())
    const honeypotRes = await app.postSubscribe(
      validSubmission({ honeypot: "bot" }),
      nextTestClientAddress()
    )

    expect(genuineRes.status).toBe(honeypotRes.status)
    expect(await genuineRes.json()).toEqual(await honeypotRes.json())
  })
})
