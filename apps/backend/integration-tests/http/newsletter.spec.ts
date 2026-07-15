import { ContainerRegistrationKeys, generateJwtToken, Modules } from "@medusajs/framework/utils"
import type { IProductModuleService } from "@medusajs/framework/types"
import { NEWSLETTER_MODULE } from "../../src/modules/newsletter"
import type NewsletterModuleService from "../../src/modules/newsletter/service"
import { TRADING_CARDS_MODULE } from "../../src/modules/trading-cards"
import type TradingCardsModuleService from "../../src/modules/trading-cards/service"
import { createTradingCardForProductWorkflow } from "../../src/workflows/trading-cards/create-trading-card-for-product"
import { createVariantForProductVariantWorkflow } from "../../src/workflows/trading-cards/create-variant-for-product-variant"
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

describe("GET /admin/trading-cards/by-product/:id", () => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required for HTTP integration tests")
  const adminToken = generateJwtToken({
    actor_id: "user_trading_card_http_test",
    actor_type: "user",
    auth_identity_id: "auth_trading_card_http_test",
  }, { secret: process.env.JWT_SECRET, expiresIn: 3600 })

  const getTradingCard = (productId: string, authenticated = true) => fetch(
    `${app.baseUrl}/admin/trading-cards/by-product/${encodeURIComponent(productId)}`,
    { headers: authenticated ? { authorization: `Bearer ${adminToken}` } : {} }
  )

  it("uses normal Admin authentication", async () => {
    expect((await getTradingCard("prod_missing", false)).status).toBe(401)
  })

  it("returns a stable null response for an unlinked product", async () => {
    const response = await getTradingCard("prod_missing")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ trading_card: null })
  })

  it("returns card and variant data created through the link workflows", async () => {
    const products = app.container.resolve<IProductModuleService>(Modules.PRODUCT)
    const cards = app.container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    const marker = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const product = await products.createProducts({
      title: `Trading card HTTP test ${marker}`,
      status: "draft",
      variants: [{ title: "Near Mint Holo", manage_inventory: false }],
    })
    const set = await cards.createCardSets({
      game: "POKEMON", language: "EN", display_name: "HTTP Test Set", provider_set_code: `http_${marker}`,
    })
    const { result: card } = await createTradingCardForProductWorkflow(app.container).run({ input: {
      productId: product.id,
      card: {
        card_set_id: set.id, name: "Gengar", search_name: "gengar", card_number: "066/196",
        origin: "MANUAL",
      },
    } })
    const productVariant = product.variants?.[0]
    expect(productVariant).toBeDefined()
    const { result: variant } = await createVariantForProductVariantWorkflow(app.container).run({ input: {
      productVariantId: productVariant!.id,
      tradingCardId: card.id,
      condition: "NEAR_MINT",
      conditionSource: "EXPLICIT",
      finish: "HOLO",
      finishConfirmed: true,
      specialTreatment: "NONE",
      specialTreatmentConfirmed: true,
      isHighValueTrackIndividually: true,
    } })

    const response = await getTradingCard(product.id)
    expect(response.status).toBe(200)
    expect((await response.json()).trading_card).toMatchObject({
      id: card.id,
      name: "Gengar",
      card_number: "066/196",
      medusa_product_id: product.id,
      card_set: { display_name: "HTTP Test Set", language: "EN" },
      variants: [{
        id: variant.id,
        medusa_product_variant_id: productVariant!.id,
        condition: "NEAR_MINT",
        finish: "HOLO",
        price_locked: false,
        is_high_value_track_individually: true,
      }],
    })

  })

  it("rejects a product variant from a different product before creating domain or link state", async () => {
    const products = app.container.resolve<IProductModuleService>(Modules.PRODUCT)
    const cards = app.container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    const query = app.container.resolve(ContainerRegistrationKeys.QUERY)
    const marker = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const [productA, productB] = await products.createProducts([
      { title: `Hierarchy A ${marker}`, status: "draft", variants: [{ title: "A", manage_inventory: false }] },
      { title: `Hierarchy B ${marker}`, status: "draft", variants: [{ title: "B", manage_inventory: false }] },
    ])
    const set = await cards.createCardSets({
      game: "POKEMON", language: "EN", display_name: "Hierarchy Test Set", provider_set_code: `hier_${marker}`,
    })
    const { result: card } = await createTradingCardForProductWorkflow(app.container).run({ input: {
      productId: productA.id,
      card: { card_set_id: set.id, name: "Eevee", search_name: "eevee", card_number: "104/203", origin: "MANUAL" },
    } })
    const input = {
      tradingCardId: card.id,
      condition: "NEAR_MINT" as const,
      conditionSource: "EXPLICIT" as const,
      finish: "HOLO" as const,
      finishConfirmed: true,
      specialTreatment: "NONE" as const,
      specialTreatmentConfirmed: true,
    }
    const { result: linkedVariant } = await createVariantForProductVariantWorkflow(app.container).run({ input: {
      ...input, productVariantId: productA.variants![0].id,
    } })
    const variantsBefore = await cards.listTradingCardVariants({ trading_card_id: card.id })
    const auditsBefore = await cards.listCardAuditEntries({})

    let mismatchError: unknown
    try {
      await createVariantForProductVariantWorkflow(app.container).run({ input: {
        ...input, productVariantId: productB.variants![0].id,
      }, throwOnError: true })
    } catch (error) {
      mismatchError = error
    }
    expect((mismatchError as Error)?.message).toContain("must belong to the same Medusa product")

    expect(await cards.listTradingCardVariants({ trading_card_id: card.id })).toHaveLength(variantsBefore.length)
    expect(await cards.listCardAuditEntries({})).toHaveLength(auditsBefore.length)
    const { data } = await query.graph({
      entity: "product",
      fields: ["id", "trading_card.id", "variants.id", "variants.trading_card_variant.id"],
      filters: { id: [productA.id, productB.id] },
    })
    const linkedA = data.find((product: any) => product.id === productA.id)
    const unlinkedB = data.find((product: any) => product.id === productB.id)
    expect(linkedA).toMatchObject({
      trading_card: { id: card.id },
      variants: [{ id: productA.variants![0].id, trading_card_variant: { id: linkedVariant.id } }],
    })
    if (!unlinkedB) throw new Error("Expected the second product to be returned")
    expect(unlinkedB.trading_card).toBeUndefined()
    expect(unlinkedB.variants[0].trading_card_variant).toBeUndefined()
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

describe("TCGdex Admin review API", () => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required for HTTP integration tests")
  const adminToken = generateJwtToken({
    actor_id: "user_tcgdex_admin_http_test",
    actor_type: "user",
    auth_identity_id: "auth_tcgdex_admin_http_test",
  }, { secret: process.env.JWT_SECRET, expiresIn: 3600 })

  const uniqueMarker = (label: string) =>
    `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`

  const getAdmin = (path: string, authenticated = true) => fetch(`${app.baseUrl}${path}`, {
    headers: authenticated ? { authorization: `Bearer ${adminToken}` } : {},
  })

  async function createCardFixture(input: {
    marker: string
    cardName?: string
    setName?: string
    cardNumber?: string
  }) {
    const cards = app.container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    const set = await cards.createCardSets({
      game: "POKEMON",
      language: "EN",
      display_name: input.setName ?? `Admin review set ${input.marker}`,
      provider_set_code: `admin-${input.marker}`,
    })
    const cardNumber = input.cardNumber ?? "001/100"
    const card = await cards.createTradingCards({
      card_set_id: set.id,
      name: input.cardName ?? `Admin review card ${input.marker}`,
      search_name: (input.cardName ?? `Admin review card ${input.marker}`).toLowerCase(),
      card_number: cardNumber,
      card_number_normalised: cardNumber.toLowerCase(),
      origin: "MANUAL",
    })
    return { cards, set, card }
  }

  async function createReview(input: {
    marker: string
    cardName?: string
    setName?: string
    cardNumber?: string
    status?: "PENDING" | "APPROVED" | "REJECTED" | "APPLIED"
  }) {
    const fixture = await createCardFixture(input)
    const providerMarker = input.marker.replace(/[^A-Za-z0-9_-]/gu, "-")
    const proposal = await fixture.cards.recordTcgdexMatchResult({
      actor: "tcgdex-admin-http-test",
      source: "TCGDEX",
      tradingCardId: fixture.card.id,
      result: {
        code: "MATCHED",
        source: "AUTOMATIC",
        enrichment: {
          provider: "TCGDEX",
          providerCardId: `provider-card-${providerMarker}`,
          providerSetId: `provider-set-${providerMarker}`,
          name: `Normalised ${input.cardName ?? input.marker}`,
          localId: "001",
          category: "Pokemon",
          referenceArtworkUrl: "https://assets.tcgdex.net/example/card/high.webp",
          illustrator: "Test Illustrator",
          providerRarity: "Common",
          rarityCandidate: { status: "MAPPED", providerValue: "Common", rarity: "COMMON", iconKey: "common" },
          pokedexNumbers: [25],
          types: ["Lightning"],
          variants: { normal: true, reverse: true, holo: false, firstEdition: false },
        },
      },
    })
    if (typeof proposal.id !== "string") throw new Error("Expected a persisted proposal ID")
    const context = { actor: "tcgdex-admin-http-test", source: "TCGDEX" as const, proposalId: proposal.id }
    if (input.status === "APPROVED" || input.status === "APPLIED") {
      await fixture.cards.approveEnrichmentProposal(context)
    } else if (input.status === "REJECTED") {
      await fixture.cards.rejectEnrichmentProposal(context)
    }
    if (input.status === "APPLIED") await fixture.cards.applyApprovedEnrichmentProposal(context)
    return { ...fixture, proposal }
  }

  async function createAttempt(input: {
    marker: string
    outcome: "NO_MATCH" | "PROVIDER_ERROR" | "IDENTITY_MISMATCH"
  }) {
    const fixture = await createCardFixture({ marker: input.marker, cardName: `Attempt card ${input.marker}` })
    const result = input.outcome === "NO_MATCH"
      ? { code: "NO_MATCH", source: "AUTOMATIC", reason: "NOT_FOUND" } as const
      : input.outcome === "PROVIDER_ERROR"
        ? { code: "PROVIDER_ERROR", source: "AUTOMATIC", providerCode: "TIMEOUT", attemptCount: 1 } as const
        : {
            code: "IDENTITY_MISMATCH", source: "AUTOMATIC",
            expected: { localId: "001" },
            actual: { localId: "999", setId: `actual-${input.marker}` },
          } as const
    const attempt = await fixture.cards.recordTcgdexMatchResult({
      actor: "tcgdex-admin-http-test",
      source: "TCGDEX",
      tradingCardId: fixture.card.id,
      result,
    })
    return { ...fixture, attempt }
  }

  it("requires Admin authentication for every route", async () => {
    const responses = await Promise.all([
      getAdmin("/admin/tcgdex/reviews", false),
      getAdmin("/admin/tcgdex/reviews/tcep_missing", false),
      getAdmin("/admin/tcgdex/attempts", false),
    ])
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401])
  })

  it("returns an empty review page with stable pagination fields", async () => {
    const marker = uniqueMarker("empty")
    const response = await getAdmin(`/admin/tcgdex/reviews?q=${encodeURIComponent(marker)}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ reviews: [], count: 0, limit: 20, offset: 0 })
  })

  it("paginates persisted review proposals", async () => {
    const marker = uniqueMarker("page")
    await Promise.all(["one", "two", "three"].map((suffix) => createReview({
      marker: `${marker}-${suffix}`,
      cardName: `${marker} card ${suffix}`,
    })))
    const response = await getAdmin(`/admin/tcgdex/reviews?q=${encodeURIComponent(marker)}&limit=1&offset=1`)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ count: 3, limit: 1, offset: 1 })
    expect(body.reviews).toHaveLength(1)
  })

  it("filters reviews by their current status", async () => {
    const marker = uniqueMarker("status")
    await createReview({ marker: `${marker}-pending`, cardName: `${marker} pending` })
    const rejected = await createReview({ marker: `${marker}-rejected`, cardName: `${marker} rejected`, status: "REJECTED" })
    const response = await getAdmin(`/admin/tcgdex/reviews?q=${encodeURIComponent(marker)}&status=REJECTED`)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.count).toBe(1)
    expect(body.reviews).toEqual([expect.objectContaining({ id: rejected.proposal.id, review_status: "REJECTED" })])
  })

  it("searches card, set, number, provider card ID, and provider set ID", async () => {
    const marker = uniqueMarker("search")
    const fixture = await createReview({
      marker,
      cardName: `Pikachu ${marker}`,
      setName: `Search set ${marker}`,
      cardNumber: `025/${marker.slice(-5)}`,
    })
    const terms = [
      `Pikachu ${marker}`,
      `Search set ${marker}`,
      `025/${marker.slice(-5)}`,
      `provider-card-${marker}`,
      `provider-set-${marker}`,
    ]
    for (const term of terms) {
      const response = await getAdmin(`/admin/tcgdex/reviews?q=${encodeURIComponent(term)}`)
      expect(response.status).toBe(200)
      expect((await response.json()).reviews).toEqual([
        expect.objectContaining({ id: fixture.proposal.id }),
      ])
    }
  })

  it("returns a safe not-found response for a missing proposal", async () => {
    const response = await getAdmin("/admin/tcgdex/reviews/tcep_missing")
    expect(response.status).toBe(404)
    const body = await response.json()
    expect(JSON.stringify(body)).toContain("TCGdex review proposal not found.")
  })

  it("returns only safe, normalised single-review and audit fields", async () => {
    const marker = uniqueMarker("single")
    const fixture = await createReview({ marker, cardName: `Safe card ${marker}`, status: "APPROVED" })
    const response = await getAdmin(`/admin/tcgdex/reviews/${fixture.proposal.id}`)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Object.keys(body)).toEqual(["review"])
    expect(Object.keys(body.review).sort()).toEqual([
      "audit_history", "card_set", "match_source", "proposal", "review_status",
      "reviewer_id", "snapshot", "timestamps", "trading_card",
    ])
    expect(body.review).toMatchObject({
      proposal: {
        id: fixture.proposal.id,
        provider: "TCGDEX",
        provider_card_id: `provider-card-${marker}`,
        provider_set_id: `provider-set-${marker}`,
      },
      trading_card: { id: fixture.card.id, name: `Safe card ${marker}`, card_number: "001/100" },
      card_set: { id: fixture.set.id, display_name: `Admin review set ${marker}`, language: "EN" },
      review_status: "APPROVED",
      match_source: "AUTOMATIC",
      snapshot: {
        provider: "TCGDEX",
        providerCardId: `provider-card-${marker}`,
        providerSetId: `provider-set-${marker}`,
        name: `Normalised Safe card ${marker}`,
      },
    })
    expect(body.review.audit_history.length).toBeGreaterThanOrEqual(2)
    expect(Object.keys(body.review.audit_history[0]).sort()).toEqual(["action", "actor", "created_at", "id", "source"])
    const serialized = JSON.stringify(body)
    expect(serialized).not.toMatch(/snapshot_fingerprint|diagnostic_fingerprint|old_value|new_value|deleted_at|raw_payload|rawPayload/)
  })

  it("filters safe non-match attempts and supports card search", async () => {
    const marker = uniqueMarker("attempt")
    await createAttempt({ marker: `${marker}-no-match`, outcome: "NO_MATCH" })
    const providerError = await createAttempt({ marker: `${marker}-provider`, outcome: "PROVIDER_ERROR" })
    const response = await getAdmin(
      `/admin/tcgdex/attempts?q=${encodeURIComponent(marker)}&outcome=PROVIDER_ERROR`
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ count: 1, limit: 20, offset: 0 })
    expect(body.attempts).toEqual([expect.objectContaining({
      id: providerError.attempt.id,
      outcome: "PROVIDER_ERROR",
      safe_provider_error_code: "TIMEOUT",
      trading_card: expect.objectContaining({
        id: providerError.card.id,
        name: `Attempt card ${marker}-provider`,
      }),
    })])
    expect(JSON.stringify(body)).not.toMatch(/diagnostic_fingerprint|attemptCount|message|stack|raw/i)
  })

  it("returns simple safe text for invalid runtime input", async () => {
    const response = await getAdmin("/admin/tcgdex/reviews?limit=not-a-number")
    expect(response.status).toBe(400)
    const serialized = JSON.stringify(await response.json())
    expect(serialized).toContain("The request parameters are invalid.")
    expect(serialized).not.toMatch(/Zod|invalid_type|NaN|stack|expected/i)
  })

  it("leaves the GB storefront newsletter route behaviour unchanged", async () => {
    const response = await app.postSubscribe(validSubmission({ countryCode: "gb" }))
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual(ACCEPTED_BODY)
  })
})
