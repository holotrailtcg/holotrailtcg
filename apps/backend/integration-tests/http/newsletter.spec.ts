import { ContainerRegistrationKeys, generateJwtToken, Modules } from "@medusajs/framework/utils"
import type { IProductModuleService, IStockLocationService } from "@medusajs/framework/types"
import sharp from "sharp"
import { NEWSLETTER_MODULE } from "../../src/modules/newsletter"
import type NewsletterModuleService from "../../src/modules/newsletter/service"
import { TRADING_CARDS_MODULE } from "../../src/modules/trading-cards"
import type TradingCardsModuleService from "../../src/modules/trading-cards/service"
import { TRADING_CARD_INVENTORY_MODULE } from "../../src/modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../src/modules/trading-card-inventory/service"
import { TCGDEX_ERROR_CODE, TcgDexError } from "../../src/modules/trading-cards/tcgdex"
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

  const postAdmin = (path: string, body?: unknown, authenticated = true) => fetch(`${app.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authenticated ? { authorization: `Bearer ${adminToken}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  })

  function minimalTcgDexCard(input: { id: string; setId: string; localId: string; name?: string }) {
    return {
      category: "Pokemon",
      id: input.id,
      localId: input.localId,
      name: input.name ?? "Fetched from TCGdex",
      set: { id: input.setId, name: "Fetched set" },
      variants: { normal: true, reverse: false, holo: false, firstEdition: false },
    }
  }

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

  describe("review actions", () => {
    it("requires Admin authentication for every write route", async () => {
      const fixture = await createReview({ marker: uniqueMarker("auth") })
      const responses = await Promise.all([
        postAdmin(`/admin/tcgdex/reviews/${fixture.proposal.id}/approve`, undefined, false),
        postAdmin(`/admin/tcgdex/reviews/${fixture.proposal.id}/reject`, undefined, false),
        postAdmin(`/admin/tcgdex/reviews/${fixture.proposal.id}/apply`, undefined, false),
        postAdmin(`/admin/tcgdex/cards/${fixture.card.id}/retry`, undefined, false),
      ])
      expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401])
    })

    it("approves a pending proposal, attributes the authenticated actor, and is idempotent", async () => {
      const fixture = await createReview({ marker: uniqueMarker("approve") })
      const response = await postAdmin(`/admin/tcgdex/reviews/${fixture.proposal.id}/approve`)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.review).toMatchObject({ review_status: "APPROVED", reviewer_id: "user_tcgdex_admin_http_test" })
      expect(body.review.audit_history[0]).toMatchObject({
        action: "TCGDEX_ENRICHMENT_APPROVED", actor: "user_tcgdex_admin_http_test",
      })

      const repeat = await postAdmin(`/admin/tcgdex/reviews/${fixture.proposal.id}/approve`)
      expect(repeat.status).toBe(200)
      expect((await repeat.json()).review.review_status).toBe("APPROVED")
    })

    it("rejects a pending proposal with a bounded reason", async () => {
      const fixture = await createReview({ marker: uniqueMarker("reject") })
      const response = await postAdmin(`/admin/tcgdex/reviews/${fixture.proposal.id}/reject`, { reason: "Wrong illustration" })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.review.review_status).toBe("REJECTED")
    })

    it("rejects an over-length reason with simple safe text", async () => {
      const fixture = await createReview({ marker: uniqueMarker("reject-invalid") })
      const response = await postAdmin(`/admin/tcgdex/reviews/${fixture.proposal.id}/reject`, { reason: "x".repeat(301) })
      expect(response.status).toBe(400)
      const serialized = JSON.stringify(await response.json())
      expect(serialized).toContain("The request parameters are invalid.")
      expect(serialized).not.toMatch(/Zod|invalid_type|stack/i)
    })

    it("applies an approved proposal, ignoring any browser-supplied enrichment data", async () => {
      const fixture = await createReview({ marker: uniqueMarker("apply"), status: "APPROVED" })
      const response = await postAdmin(`/admin/tcgdex/reviews/${fixture.proposal.id}/apply`, {
        enrichment: { name: "Attacker-supplied name" }, name: "Attacker-supplied name",
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.review.review_status).toBe("APPLIED")

      const cards = app.container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
      const [savedCard] = await cards.listTradingCards({ id: fixture.card.id })
      expect(savedCard.name).toBe(body.review.snapshot.name)
      expect(savedCard.name).not.toBe("Attacker-supplied name")
    })

    it("refuses to apply a proposal that is not approved", async () => {
      const fixture = await createReview({ marker: uniqueMarker("apply-invalid") })
      const response = await postAdmin(`/admin/tcgdex/reviews/${fixture.proposal.id}/apply`)
      expect(response.status).toBe(400)
    })

    it("retries a trading card and persists a matched proposal using only trusted, database-held identity", async () => {
      const marker = uniqueMarker("retry-match")
      const fixture = await createCardFixture({ marker, cardNumber: "010/198" })
      const callsBefore = app.tcgdexClient.calls.length
      app.tcgdexClient.enqueue(minimalTcgDexCard({
        id: `retry-card-${marker}`, setId: fixture.set.provider_set_code, localId: "010",
        name: `Retried ${marker}`,
      }))

      const response = await postAdmin(`/admin/tcgdex/cards/${fixture.card.id}/retry`)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.outcome).toBe("MATCHED")
      expect(body.review).toMatchObject({
        review_status: "PENDING",
        trading_card: expect.objectContaining({ id: fixture.card.id }),
      })
      expect(app.tcgdexClient.calls.slice(callsBefore)).toEqual([
        expect.objectContaining({ operation: "getCardBySetAndLocalId", setId: fixture.set.provider_set_code, localId: "010/198" }),
      ])
      const serialized = JSON.stringify(body)
      expect(serialized).not.toMatch(/snapshot_fingerprint|diagnostic_fingerprint|old_value|new_value|deleted_at/)
    })

    it("retries a trading card and persists a safe diagnostic attempt when TCGdex has no match", async () => {
      const marker = uniqueMarker("retry-no-match")
      const fixture = await createCardFixture({ marker, cardNumber: "011/198" })
      app.tcgdexClient.enqueueError(new TcgDexError({ code: TCGDEX_ERROR_CODE.NOT_FOUND, operation: "get-card-by-set-and-local-id", message: "not found" }))

      const response = await postAdmin(`/admin/tcgdex/cards/${fixture.card.id}/retry`)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.outcome).toBe("NO_MATCH")
      expect(body.attempt).toMatchObject({ outcome: "NO_MATCH", trading_card: expect.objectContaining({ id: fixture.card.id }) })
      const serialized = JSON.stringify(body)
      expect(serialized).not.toMatch(/message|stack|diagnostic_fingerprint/i)
    })

    it("retries a trading card without a trusted set identity and records a safe diagnostic instead of guessing", async () => {
      const marker = uniqueMarker("retry-no-set")
      const cards = app.container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
      // A whitespace-only `provider_set_code` trims to empty, so the matcher
      // treats it as an invalid identity rather than guessing. The
      // whitespace pattern is derived from `marker` (space/tab per
      // character) so the DB's (game, language, provider_set_code) unique
      // index never collides with another whitespace-only row left behind
      // by an earlier run against this persistent test database.
      const providerSetCode = [...marker].map((character, index) => ((character.charCodeAt(0) + index) % 2 === 0 ? " " : "\t")).join("")
      const set = await cards.createCardSets({
        game: "POKEMON", language: "EN", display_name: `No set code ${marker}`, provider_set_code: providerSetCode,
      })
      const card = await cards.createTradingCards({
        card_set_id: set.id, name: `No set code card ${marker}`, search_name: "no set code",
        card_number: "012/198", card_number_normalised: "012/198", origin: "MANUAL",
      })
      const callsBefore = app.tcgdexClient.calls.length

      const response = await postAdmin(`/admin/tcgdex/cards/${card.id}/retry`)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.outcome).toBe("INVALID_LOCAL_IDENTITY")
      expect(app.tcgdexClient.calls.length).toBe(callsBefore)
    })

    it("returns a safe not-found response for approve, reject, apply and retry on unknown IDs", async () => {
      const responses = await Promise.all([
        postAdmin("/admin/tcgdex/reviews/tcep_missing/approve"),
        postAdmin("/admin/tcgdex/reviews/tcep_missing/reject"),
        postAdmin("/admin/tcgdex/reviews/tcep_missing/apply"),
        postAdmin("/admin/tcgdex/cards/tcard_missing/retry"),
      ])
      for (const response of responses) {
        expect(response.status).toBe(404)
      }
    })
  })

  it("leaves the GB storefront newsletter route behaviour unchanged", async () => {
    const response = await app.postSubscribe(validSubmission({ countryCode: "gb" }))
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual(ACCEPTED_BODY)
  })
})

/**
 * Stage 4B.2 Admin card-image upload/confirm routes. Lives in this file
 * (despite its name) for the same reason the TCGdex Admin review API tests
 * above do: `startApp()` boots the real Medusa app once for the whole
 * `integration-tests/http/*.spec.ts` suite, and Medusa's module registry is
 * process-wide static state that cannot survive a second boot in one Jest
 * worker — see the top-of-file comment. `app.r2ImageClient` (a
 * `FakeR2ImageStorageClient`, registered in `support/bootstrap.ts` under the
 * same lazy-DI key the real `resolveR2ImageStorageClient` would use) is the
 * only R2 client ever constructed anywhere in this suite: `R2_IMAGES_ENABLED`
 * is never set to `"true"` in `TEST_ENV_OVERRIDES`, so even if the fake's
 * registration were somehow bypassed, `resolveR2Config()` would report
 * disabled and the real `S3Client` would still never be constructed.
 */
describe("Admin trading-card image upload/confirm", () => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required for HTTP integration tests")
  const adminToken = generateJwtToken({
    actor_id: "user_card_image_http_test",
    actor_type: "user",
    auth_identity_id: "auth_card_image_http_test",
  }, { secret: process.env.JWT_SECRET, expiresIn: 3600 })

  const uniqueMarker = (label: string) =>
    `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`

  async function createVariantFixture(marker: string) {
    const cards = app.container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    const set = await cards.createCardSets({
      game: "POKEMON", language: "EN", display_name: `Image HTTP set ${marker}`, provider_set_code: `img-${marker}`,
    })
    const card = await cards.createTradingCards({
      card_set_id: set.id, name: `Image HTTP card ${marker}`, search_name: `image http card ${marker}`,
      card_number: "001/100", card_number_normalised: "001/100", origin: "MANUAL",
    })
    const variant = await cards.createTradingCardVariants({
      trading_card_id: card.id, condition: "NEAR_MINT", condition_source: "DEFAULTED",
      finish: "HOLO", finish_confirmed: true, special_treatment: "NONE", special_treatment_confirmed: true,
      sku: `POKEMON-EN-IMG-${marker.toUpperCase()}`, origin: "MANUAL",
    })
    return { cards, set, card, variant }
  }

  function buildJpegFixture(): Promise<Buffer> {
    return sharp({
      create: { width: 6, height: 8, channels: 3, background: { r: 200, g: 40, b: 40 } },
    }).jpeg().toBuffer()
  }

  const uploadBody = (overrides: Record<string, unknown> = {}) => ({
    originalFilename: "card.jpg", declaredMimeType: "image/jpeg", declaredByteSize: 1_048_576, ...overrides,
  })

  it("requires Admin authentication for both routes", async () => {
    const { variant } = await createVariantFixture(uniqueMarker("auth"))
    const responses = await Promise.all([
      app.postBeginUpload(variant.id, uploadBody()),
      app.postConfirmUpload("tcimg_missing"),
    ])
    expect(responses.map((response) => response.status)).toEqual([401, 401])
  })

  it("requests an upload target and returns a presigned URL for the staging key", async () => {
    const { variant } = await createVariantFixture(uniqueMarker("upload"))
    const response = await app.postBeginUpload(variant.id, uploadBody(), adminToken)
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "imageId", "objectKey", "requiredHeaders", "uploadUrl"])
    expect(body.objectKey).toContain(`card-images/${variant.id}/`)
    expect(app.r2ImageClient.presignCalls.some((call) => call.key === body.objectKey)).toBe(true)
  })

  it("returns a safe not-found response for an unknown variant", async () => {
    const response = await app.postBeginUpload("tcvar_missing", uploadBody(), adminToken)
    expect(response.status).toBe(404)
  })

  it("rejects an invalid upload-request body with a generic message", async () => {
    const { variant } = await createVariantFixture(uniqueMarker("invalid"))
    const response = await app.postBeginUpload(variant.id, uploadBody({ declaredMimeType: "image/gif" }), adminToken)
    expect(response.status).toBe(400)
    const serialized = JSON.stringify(await response.json())
    expect(serialized).toContain("The request parameters are invalid.")
    expect(serialized).not.toMatch(/Zod|invalid_type|stack/i)
  })

  it("confirms a valid upload end-to-end", async () => {
    const { variant } = await createVariantFixture(uniqueMarker("confirm"))
    const uploadResponse = await app.postBeginUpload(variant.id, uploadBody(), adminToken)
    const { imageId, objectKey } = await uploadResponse.json()
    app.r2ImageClient.seedObject(objectKey, await buildJpegFixture())

    const confirmResponse = await app.postConfirmUpload(imageId, adminToken)
    expect(confirmResponse.status).toBe(200)
    const body = await confirmResponse.json()
    expect(body).toMatchObject({ id: imageId, status: "READY", width: 6, height: 8, confirmedMimeType: "image/jpeg" })
    // R2_IMAGES_ENABLED is never "true" in TEST_ENV_OVERRIDES, so no public
    // base URL is configured here; null is the expected test-environment
    // value, not a bug.
    expect(body.imageUrl).toBeNull()
    const serialized = JSON.stringify(body)
    expect(serialized).not.toMatch(/staging_object_key|final_object_key|sha256/i)
  })

  it("rejects confirming an already-confirmed upload without a 500", async () => {
    const { variant } = await createVariantFixture(uniqueMarker("dup-confirm"))
    const uploadResponse = await app.postBeginUpload(variant.id, uploadBody(), adminToken)
    const { imageId, objectKey } = await uploadResponse.json()
    app.r2ImageClient.seedObject(objectKey, await buildJpegFixture())

    const first = await app.postConfirmUpload(imageId, adminToken)
    expect(first.status).toBe(200)
    const second = await app.postConfirmUpload(imageId, adminToken)
    expect(second.status).toBe(400)
    expect(JSON.stringify(await second.json())).toContain("already been confirmed")
  })

  it("rejects an expired upload", async () => {
    const { variant } = await createVariantFixture(uniqueMarker("expired"))
    const uploadResponse = await app.postBeginUpload(variant.id, uploadBody(), adminToken)
    const { imageId, objectKey } = await uploadResponse.json()
    app.r2ImageClient.seedObject(objectKey, await buildJpegFixture())
    const pgConnection = app.container.resolve<{ raw: (query: string, params?: unknown[]) => Promise<unknown> }>(
      ContainerRegistrationKeys.PG_CONNECTION
    )
    await pgConnection.raw(`update trading_card_image set upload_expires_at = now() - interval '1 minute' where id = ?`, [imageId])

    const response = await app.postConfirmUpload(imageId, adminToken)
    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain("expired")
  })

  it("rejects an unsupported format, a corrupted file, a zero-byte upload, and an oversized upload", async () => {
    const cases: Array<{ label: string; bytes: Buffer; expectedMessageFragment: string }> = [
      {
        label: "unsupported",
        bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"></svg>'),
        expectedMessageFragment: "not a supported image format",
      },
      {
        label: "corrupted",
        bytes: Buffer.from("not an image, just plain text bytes"),
        expectedMessageFragment: "corrupted or not a readable image",
      },
      { label: "zero-byte", bytes: Buffer.alloc(0), expectedMessageFragment: "was empty" },
      { label: "oversized", bytes: Buffer.alloc(11 * 1024 * 1024, 1), expectedMessageFragment: "exceeds the" },
    ]

    for (const testCase of cases) {
      const { variant } = await createVariantFixture(uniqueMarker(testCase.label))
      const uploadResponse = await app.postBeginUpload(variant.id, uploadBody(), adminToken)
      const { imageId, objectKey } = await uploadResponse.json()
      app.r2ImageClient.seedObject(objectKey, testCase.bytes)

      const response = await app.postConfirmUpload(imageId, adminToken)
      expect(response.status).toBe(400)
      expect(JSON.stringify(await response.json())).toContain(testCase.expectedMessageFragment)
    }
  })
})

/**
 * Stage 4B.3 Admin card-image list/detail/reorder/archive/restore/focal-point
 * routes. Lives in this file for the same process-wide-module-registry
 * reason documented above the Stage 4B.2 `describe` block.
 */
describe("Admin trading-card image list, detail and lifecycle actions", () => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required for HTTP integration tests")
  const adminToken = generateJwtToken({
    actor_id: "user_card_image_assignment_http_test",
    actor_type: "user",
    auth_identity_id: "auth_card_image_assignment_http_test",
  }, { secret: process.env.JWT_SECRET, expiresIn: 3600 })

  const uniqueMarker = (label: string) =>
    `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`

  let fixtureColorCounter = 0

  /** Each call produces distinct bytes (and therefore a distinct SHA-256), so uploading several images to the same variant never collides with the per-variant duplicate check. */
  function buildJpegFixture(): Promise<Buffer> {
    fixtureColorCounter += 1
    return sharp({
      create: { width: 6, height: 8, channels: 3, background: { r: 200, g: 40, b: fixtureColorCounter % 256 } },
    }).jpeg().toBuffer()
  }

  async function createVariantFixture(marker: string, overrides: Record<string, unknown> = {}) {
    const cards = app.container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    const set = await cards.createCardSets({
      game: "POKEMON", language: "EN", display_name: `Image Assignment set ${marker}`, provider_set_code: `imga-${marker}`,
    })
    const card = await cards.createTradingCards({
      card_set_id: set.id, name: `Image Assignment card ${marker}`, search_name: `image assignment card ${marker}`,
      card_number: "002/100", card_number_normalised: "002/100", origin: "MANUAL",
    })
    const variant = await cards.createTradingCardVariants({
      trading_card_id: card.id, condition: "NEAR_MINT", condition_source: "DEFAULTED",
      finish: "HOLO", finish_confirmed: true, special_treatment: "NONE", special_treatment_confirmed: true,
      sku: `POKEMON-EN-IMGA-${marker.toUpperCase()}`, origin: "MANUAL", ...overrides,
    })
    return { cards, set, card, variant }
  }

  async function createReadyImage(variantId: string) {
    const uploadResponse = await app.postBeginUpload(variantId, {
      originalFilename: "card.jpg", declaredMimeType: "image/jpeg", declaredByteSize: 1_048_576,
    }, adminToken)
    const { imageId, objectKey } = await uploadResponse.json()
    app.r2ImageClient.seedObject(objectKey, await buildJpegFixture())
    const confirmResponse = await app.postConfirmUpload(imageId, adminToken)
    return confirmResponse.json()
  }

  it("requires Admin authentication for every new route", async () => {
    const { variant } = await createVariantFixture(uniqueMarker("auth"))
    const responses = await Promise.all([
      app.getNeedingImages({}),
      app.getCardImages(variant.trading_card_id ?? "tcard_missing"),
      app.postReorder(variant.id, { orderedImageIds: [] }),
      app.postArchive("tcimg_missing"),
      app.postRestore("tcimg_missing"),
      app.postFocalPoint("tcimg_missing", { focalX: 0.5, focalY: 0.5 }),
      app.getVariantThumbnails(["tcv_missing"]),
    ])
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401, 401])
  })

  describe("needing-images list", () => {
    it("classifies a card as MISSING, PARTIAL or READY based on variant coverage", async () => {
      const marker = uniqueMarker("classify")
      const { card, variant } = await createVariantFixture(marker)

      const missingListResponse = await app.getNeedingImages({ q: marker }, adminToken)
      const missingList = await missingListResponse.json()
      expect(missingList.cards).toEqual([expect.objectContaining({ trading_card_id: card.id, need_status: "MISSING" })])

      await createReadyImage(variant.id)

      const readyListResponse = await app.getNeedingImages({ q: marker }, adminToken)
      const readyList = await readyListResponse.json()
      expect(readyList.cards).toEqual([expect.objectContaining({ trading_card_id: card.id, need_status: "READY" })])
    })

    it("supports pagination fields and a status filter", async () => {
      const marker = uniqueMarker("paginate")
      await createVariantFixture(marker)

      const response = await app.getNeedingImages({ q: marker, status: "MISSING", limit: "1" }, adminToken)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toMatchObject({ limit: 1, offset: 0 })
      expect(typeof body.count).toBe("number")
    })

    it("scopes results to tradingCardIds when provided, ignoring cards outside the list", async () => {
      const marker = uniqueMarker("scoped")
      const { card: includedCard } = await createVariantFixture(`${marker}-in`)
      await createVariantFixture(`${marker}-out`)

      const response = await app.getNeedingImages({ tradingCardIds: includedCard.id }, adminToken)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.cards.map((row: { trading_card_id: string }) => row.trading_card_id)).toEqual([includedCard.id])
    })
  })

  describe("card detail", () => {
    it("splits ready and archived images and returns a 404 for an unknown card", async () => {
      const marker = uniqueMarker("detail")
      const { card, variant } = await createVariantFixture(marker)
      const image = await createReadyImage(variant.id)
      await app.postArchive(image.id, adminToken)
      const secondImage = await createReadyImage(variant.id)

      const response = await app.getCardImages(card.id, adminToken)
      expect(response.status).toBe(200)
      const body = await response.json()
      const variantGroup = body.variants.find((entry: { id: string }) => entry.id === variant.id)
      expect(variantGroup.ready_images).toEqual([expect.objectContaining({ id: secondImage.id })])
      expect(variantGroup.archived_images).toEqual([expect.objectContaining({ id: image.id })])
      expect(body.tcgdex_reference_artwork_url).toBeNull()

      const missingResponse = await app.getCardImages("tcard_missing", adminToken)
      expect(missingResponse.status).toBe(404)
    })
  })

  describe("variant thumbnails", () => {
    // Photo-vs-TCGdex priority is covered at the unit level
    // (admin-image-review.unit.spec.ts), with a fake `derivePublicImageUrl`
    // — R2_IMAGES_ENABLED is never "true" in this HTTP suite (see the
    // comment above "Admin trading-card image upload/confirm"), so a ready
    // photograph here never has a derivable public URL and this endpoint
    // correctly falls back to TCGdex art, exactly as it would for any
    // photo whose URL cannot be derived.
    it("falls back to TCGdex reference art when there is no derivable photo URL, and returns null for neither, and for an unknown variant", async () => {
      const marker = uniqueMarker("thumb")
      const { cards, card: tcgdexOnlyCard, variant: tcgdexOnlyVariant } = await createVariantFixture(`${marker}-tcgdex`)
      await cards.recordTcgdexMatchResult({
        actor: "thumbnails-http-test", source: "TCGDEX", tradingCardId: tcgdexOnlyCard.id,
        result: {
          code: "MATCHED", source: "AUTOMATIC",
          enrichment: {
            provider: "TCGDEX", providerCardId: `provider-card-${marker}-tcgdex`, providerSetId: `provider-set-${marker}-tcgdex`,
            name: `Normalised ${marker}-tcgdex`, localId: "001", category: "Pokemon",
            referenceArtworkUrl: "https://assets.tcgdex.net/example/card/tcgdex-only.webp",
            illustrator: "Test Illustrator", providerRarity: "Common",
            rarityCandidate: { status: "MAPPED", providerValue: "Common", rarity: "COMMON", iconKey: "common" },
            pokedexNumbers: [25], types: ["Lightning"],
            variants: { normal: true, reverse: true, holo: false, firstEdition: false },
          },
        },
      })

      const { variant: neitherVariant } = await createVariantFixture(`${marker}-neither`)

      const response = await app.getVariantThumbnails([tcgdexOnlyVariant.id, neitherVariant.id, "tcv_unknown"], adminToken)
      expect(response.status).toBe(200)
      const body = await response.json()

      expect(body.thumbnails[tcgdexOnlyVariant.id]).toEqual({
        tradingCardId: tcgdexOnlyCard.id,
        source: "TCGDEX",
        imageUrl: "https://assets.tcgdex.net/example/card/tcgdex-only.webp",
        photoUrl: null,
        tcgdexImageUrl: "https://assets.tcgdex.net/example/card/tcgdex-only.webp",
      })
      expect(body.thumbnails[neitherVariant.id]).toEqual({
        tradingCardId: expect.any(String), source: null, imageUrl: null, photoUrl: null, tcgdexImageUrl: null,
      })
      expect(body.thumbnails.tcv_unknown).toEqual({
        tradingCardId: null, source: null, imageUrl: null, photoUrl: null, tcgdexImageUrl: null,
      })
    })
  })

  describe("reorder", () => {
    it("reorders ready images and rejects a partial or foreign set", async () => {
      const { variant } = await createVariantFixture(uniqueMarker("reorder"))
      const first = await createReadyImage(variant.id)
      const second = await createReadyImage(variant.id)

      const response = await app.postReorder(variant.id, { orderedImageIds: [second.id, first.id] }, adminToken)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.images.map((image: { id: string }) => image.id)).toEqual([second.id, first.id])

      const partialResponse = await app.postReorder(variant.id, { orderedImageIds: [second.id] }, adminToken)
      expect(partialResponse.status).toBe(400)

      const { variant: otherVariant } = await createVariantFixture(uniqueMarker("reorder-other"))
      const foreignImage = await createReadyImage(otherVariant.id)
      const foreignResponse = await app.postReorder(
        variant.id, { orderedImageIds: [second.id, foreignImage.id] }, adminToken
      )
      expect(foreignResponse.status).toBe(400)
    })
  })

  describe("archive and restore", () => {
    it("archives a ready image, is idempotent, and rejects a non-ready image", async () => {
      const { variant } = await createVariantFixture(uniqueMarker("archive"))
      const image = await createReadyImage(variant.id)

      const response = await app.postArchive(image.id, adminToken)
      expect(response.status).toBe(200)
      expect((await response.json()).status).toBe("ARCHIVED")

      const idempotentResponse = await app.postArchive(image.id, adminToken)
      expect(idempotentResponse.status).toBe(200)

      const uploadResponse = await app.postBeginUpload(variant.id, {
        originalFilename: "card.jpg", declaredMimeType: "image/jpeg", declaredByteSize: 1_048_576,
      }, adminToken)
      const { imageId } = await uploadResponse.json()
      const pendingArchiveResponse = await app.postArchive(imageId, adminToken)
      expect(pendingArchiveResponse.status).toBe(400)
    })

    it("restores an archived image to the end of the active order and rejects a non-archived image", async () => {
      const { variant } = await createVariantFixture(uniqueMarker("restore"))
      const image = await createReadyImage(variant.id)
      await app.postArchive(image.id, adminToken)

      const response = await app.postRestore(image.id, adminToken)
      expect(response.status).toBe(200)
      expect((await response.json()).status).toBe("READY")

      const notArchivedResponse = await app.postRestore(image.id, adminToken)
      expect(notArchivedResponse.status).toBe(400)
    })
  })

  describe("focal point", () => {
    it("updates the focal point on a ready image and rejects out-of-range or non-ready values", async () => {
      const { variant } = await createVariantFixture(uniqueMarker("focal"))
      const image = await createReadyImage(variant.id)

      const response = await app.postFocalPoint(image.id, { focalX: 0.2, focalY: 0.8 }, adminToken)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.focalX).toBeCloseTo(0.2)
      expect(body.focalY).toBeCloseTo(0.8)

      const outOfRangeResponse = await app.postFocalPoint(image.id, { focalX: 1.5, focalY: 0.5 }, adminToken)
      expect(outOfRangeResponse.status).toBe(400)

      const uploadResponse = await app.postBeginUpload(variant.id, {
        originalFilename: "card.jpg", declaredMimeType: "image/jpeg", declaredByteSize: 1_048_576,
      }, adminToken)
      const { imageId } = await uploadResponse.json()
      const pendingResponse = await app.postFocalPoint(imageId, { focalX: 0.5, focalY: 0.5 }, adminToken)
      expect(pendingResponse.status).toBe(400)
    })
  })
})

describe("Admin trading-card-inventory", () => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required for HTTP integration tests")
  const adminToken = generateJwtToken({
    actor_id: "user_inventory_http_test",
    actor_type: "user",
    auth_identity_id: "auth_inventory_http_test",
  }, { secret: process.env.JWT_SECRET, expiresIn: 3600 })

  const uniqueMarker = (label: string) =>
    `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`

  async function createVariantFixture(marker: string) {
    const cards = app.container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    const set = await cards.createCardSets({
      game: "POKEMON", language: "EN", display_name: `Inventory HTTP set ${marker}`, provider_set_code: `inv-${marker}`,
    })
    const card = await cards.createTradingCards({
      card_set_id: set.id, name: `Inventory HTTP card ${marker}`, search_name: `inventory http card ${marker}`,
      card_number: "001/100", card_number_normalised: "001/100", origin: "MANUAL",
    })
    const variant = await cards.createTradingCardVariants({
      trading_card_id: card.id, condition: "NEAR_MINT", condition_source: "DEFAULTED",
      finish: "HOLO", finish_confirmed: true, special_treatment: "NONE", special_treatment_confirmed: true,
      sku: `POKEMON-EN-INV-${marker.toUpperCase()}`, origin: "MANUAL",
    })
    return { cards, set, card, variant }
  }

  describe("sources", () => {
    it("requires Admin authentication for every route", async () => {
      const responses = await Promise.all([
        app.getInventorySources({}),
        app.postCreateInventorySource({ displayName: "x", provider: "PULSE" }),
        app.postRenameInventorySource("tcisrc_missing", { displayName: "x" }),
        app.postArchiveInventorySource("tcisrc_missing"),
        app.postRestoreInventorySource("tcisrc_missing"),
        app.getInventorySourceSummary("tcisrc_missing"),
        app.getInventoryTransactions({}),
        app.getInventoryProposals({}),
        app.getInventoryProposal("tciprop_missing"),
        app.postReviewInventoryProposal("tciprop_missing", { targetStatus: "APPROVED" }),
        app.postBulkReviewInventoryProposals({ ids: ["tciprop_missing"], targetStatus: "APPROVED" }),
        app.postApplyInventoryProposal("tciprop_missing"),
        app.postBulkApplyInventoryProposals({ ids: ["tciprop_missing"] }),
        app.postRetryInventoryProposalSync("tciprop_missing"),
        app.getInventoryProposalSummary({ inventorySnapshotId: "tcisnap_missing" }),
        app.getInventoryReconciliationSummary("tcisnap_missing"),
        app.getPublishReadiness("tcvar_missing"),
      ])
      expect(responses.map((response) => response.status)).toEqual([
        401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 401,
      ])
    })

    it("creates a source, rejects a duplicate name, renames, archives and restores it", async () => {
      const marker = uniqueMarker("source")
      const createResponse = await app.postCreateInventorySource({
        displayName: `[ME] eBay Stock ${marker}`, provider: "PULSE", language: "EN",
      }, adminToken)
      expect(createResponse.status).toBe(201)
      const created = await createResponse.json()
      expect(Object.keys(created.source).sort()).toEqual([
        "createdAt", "defaultCurrencyCode", "defaultPricingProfileKey", "defaultStorefrontCategoryId",
        "displayName", "id", "language", "notes", "provider", "status", "updatedAt",
      ])
      expect(created.source.status).toBe("ACTIVE")

      const duplicateResponse = await app.postCreateInventorySource({
        displayName: `  [me]  ebay   stock   ${marker}  `, provider: "PULSE",
      }, adminToken)
      expect(duplicateResponse.status).toBe(400)

      const renameResponse = await app.postRenameInventorySource(created.source.id, { displayName: `Renamed ${marker}` }, adminToken)
      expect(renameResponse.status).toBe(200)
      expect((await renameResponse.json()).source.displayName).toBe(`Renamed ${marker}`)

      const archiveResponse = await app.postArchiveInventorySource(created.source.id, adminToken)
      expect(archiveResponse.status).toBe(200)
      expect((await archiveResponse.json()).source.status).toBe("ARCHIVED")

      const restoreResponse = await app.postRestoreInventorySource(created.source.id, adminToken)
      expect(restoreResponse.status).toBe(200)
      expect((await restoreResponse.json()).source.status).toBe("ACTIVE")
    })

    it("rejects invalid input before it reaches the service", async () => {
      const missingProvider = await app.postCreateInventorySource({ displayName: "No provider" }, adminToken)
      expect(missingProvider.status).toBe(400)
      const emptyName = await app.postCreateInventorySource({ displayName: "   ", provider: "PULSE" }, adminToken)
      expect(emptyName.status).toBe(400)
    })

    it("paginates the source list and returns a bounded response shape", async () => {
      const marker = uniqueMarker("page")
      for (let i = 0; i < 3; i += 1) {
        await app.postCreateInventorySource({ displayName: `[Page ${marker}] Source ${i}`, provider: "PULSE" }, adminToken)
      }
      const response = await app.getInventorySources({ limit: "2", offset: "0" }, adminToken)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(Object.keys(body).sort()).toEqual(["count", "limit", "offset", "sources"])
      expect(body.limit).toBe(2)
      expect(body.sources.length).toBeLessThanOrEqual(2)
      expect(body.count).toBeGreaterThanOrEqual(3)

      const invalidResponse = await app.getInventorySources({ limit: "not-a-number" }, adminToken)
      expect(invalidResponse.status).toBe(400)
    })

    it("returns a bounded summary with no raw internal fields", async () => {
      const inventory = app.container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
      const source = await inventory.createInventorySource({
        displayName: `Summary Source ${uniqueMarker("summary")}`, provider: "PULSE", actor: "http-test", source: "MANUAL",
      })
      const response = await app.getInventorySourceSummary((source as Record<string, unknown>).id as string, adminToken)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(Object.keys(body).sort()).toEqual([
        "approvedHoldingCount", "holdingStatusCounts", "latestSnapshot", "source", "totalGroupedQuantity", "unresolvedProposalCount",
      ])
      expect(body.latestSnapshot).toBeNull()
      expect(body.approvedHoldingCount).toBe(0)
    })

    it("returns a safe not-found response for an unknown source", async () => {
      const response = await app.getInventorySourceSummary("tcisrc_missing", adminToken)
      expect(response.status).toBe(404)
    })
  })

  describe("transactions", () => {
    it("lists appended ledger entries without exposing unrelated fields", async () => {
      const inventory = app.container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
      const { variant } = await createVariantFixture(uniqueMarker("txn"))
      await inventory.appendInventoryTransaction({
        tradingCardVariantId: variant.id, quantityBefore: 5, quantityAfter: 3,
        reason: "WEBSITE_SALE", actor: "http-test", source: "SYSTEM",
      })
      const response = await app.getInventoryTransactions({ tradingCardVariantId: variant.id }, adminToken)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.count).toBeGreaterThanOrEqual(1)
      expect(Object.keys(body.transactions[0]).sort()).toEqual([
        "actor", "createdAt", "inventoryHoldingId", "inventorySnapshotId", "inventorySourceId", "note",
        "originatingReference", "quantityAfter", "quantityBefore", "quantityDelta", "reason", "tradingCardVariantId", "id",
      ].sort())
    })

    it("rejects a malformed query", async () => {
      const response = await app.getInventoryTransactions({ limit: "not-a-number" }, adminToken)
      expect(response.status).toBe(400)
    })
  })

  describe("reconciliation proposals", () => {
    async function createReconciledSnapshot() {
      const inventory = app.container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
      const marker = uniqueMarker("reconciliation")
      const source = await inventory.createInventorySource({
        displayName: `Reconciliation HTTP ${marker}`, provider: "PULSE", actor: "http-test", source: "MANUAL",
      })
      const snapshot = await inventory.createInventorySnapshot({
        inventorySourceId: source.id as string, actor: "http-test", source: "MANUAL",
      })
      await inventory.addInventorySnapshotEntries({
        snapshotId: snapshot.id as string, actor: "http-test", source: "MANUAL", entries: [
          { providerReference: `${marker}-a`, providerReferenceType: "PULSE_PRODUCT_ID", tradingCardVariantId: `tcvar_${marker}_a`, quantity: 1, currencyCode: "GBP", unitAcquisitionCost: "1", unitMarketPrice: "2", unitSellingPrice: "3" },
          { providerReference: `${marker}-b`, providerReferenceType: "PULSE_PRODUCT_ID", tradingCardVariantId: null, quantity: 2, currencyCode: "GBP", unitAcquisitionCost: "1", unitMarketPrice: "2", unitSellingPrice: "3" },
        ],
      })
      await inventory.transitionInventorySnapshotStatus({ id: snapshot.id as string, targetStatus: "VALIDATED", actor: "http-test", source: "MANUAL" })
      await inventory.reconcileInventorySnapshot({ inventorySourceId: source.id as string, snapshotId: snapshot.id as string, actor: "http-test", source: "SYSTEM" })
      return { source, snapshot }
    }

    it("returns authenticated, paginated, filtered, allow-listed proposal reads", async () => {
      const { snapshot } = await createReconciledSnapshot()
      const response = await app.getInventoryProposals({
        inventorySnapshotId: snapshot.id as string, changeKind: "UNRESOLVED_VARIANT", limit: "1", offset: "0",
      }, adminToken)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toMatchObject({ count: 1, limit: 1, offset: 0 })
      expect(body.proposals).toHaveLength(1)
      expect(body.proposals[0].changeKind).toBe("UNRESOLVED_VARIANT")
      expect(Object.keys(body.proposals[0]).sort()).toEqual([
        "baselineSnapshotId", "card", "cardIdentityHint", "changeKind", "comparedAt", "createdAt", "currencyCode", "diagnostics", "id",
        "inventorySnapshotId", "inventorySourceId", "previousQuantity", "previousUnitAcquisitionCost",
        "previousUnitMarketPrice", "previousUnitSellingPrice", "proposedQuantity", "proposedUnitAcquisitionCost",
        "proposedUnitMarketPrice", "proposedUnitSellingPrice", "providerReference", "providerReferenceType",
        "quantityDelta", "reason", "reviewStatus", "tradingCardVariantId", "resolvedBy", "resolvedAt", "reviewNote",
        "appliedAt", "appliedTransactionId", "appliedHoldingId", "medusaSyncStatus", "medusaInventoryItemId",
        "medusaStockLocationId", "medusaSyncAttemptedAt", "medusaSyncSucceededAt", "medusaSyncRetryCount",
        "medusaSyncLastError",
      ].sort())
      expect(await app.getInventoryProposals({ limit: "101" }, adminToken).then((result) => result.status)).toBe(400)
    })

    it("attaches the matched card's tradingCardId alongside its other identity fields", async () => {
      const inventory = app.container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
      const { card, variant } = await createVariantFixture(uniqueMarker("card-identity"))
      const marker = uniqueMarker("card-identity-snapshot")
      const source = await inventory.createInventorySource({
        displayName: `Card identity HTTP ${marker}`, provider: "PULSE", actor: "http-test", source: "MANUAL",
      })
      const snapshot = await inventory.createInventorySnapshot({
        inventorySourceId: source.id as string, actor: "http-test", source: "MANUAL",
      })
      await inventory.addInventorySnapshotEntries({
        snapshotId: snapshot.id as string, actor: "http-test", source: "MANUAL", entries: [
          {
            providerReference: `${marker}-a`, providerReferenceType: "PULSE_PRODUCT_ID", tradingCardVariantId: variant.id,
            quantity: 1, currencyCode: "GBP", unitAcquisitionCost: "1", unitMarketPrice: "2", unitSellingPrice: "3",
          },
        ],
      })
      await inventory.transitionInventorySnapshotStatus({ id: snapshot.id as string, targetStatus: "VALIDATED", actor: "http-test", source: "MANUAL" })
      await inventory.reconcileInventorySnapshot({ inventorySourceId: source.id as string, snapshotId: snapshot.id as string, actor: "http-test", source: "SYSTEM" })

      const response = await app.getInventoryProposals({
        inventorySnapshotId: snapshot.id as string, changeKind: "NEW_HOLDING",
      }, adminToken)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.proposals).toHaveLength(1)
      expect(body.proposals[0].card).toMatchObject({ tradingCardId: card.id, name: card.name })
    })

    it("returns reconciliation and proposal count summaries", async () => {
      const { snapshot } = await createReconciledSnapshot()
      const reconciliationResponse = await app.getInventoryReconciliationSummary(snapshot.id as string, adminToken)
      expect(reconciliationResponse.status).toBe(200)
      expect(await reconciliationResponse.json()).toMatchObject({ snapshotId: snapshot.id, status: "PENDING_REVIEW", proposalCount: 2 })

      const proposalResponse = await app.getInventoryProposalSummary({ inventorySnapshotId: snapshot.id as string }, adminToken)
      expect(proposalResponse.status).toBe(200)
      expect(await proposalResponse.json()).toMatchObject({
        inventorySnapshotId: snapshot.id, count: 2,
        byChangeKind: { NEW_HOLDING: 1, UNRESOLVED_VARIANT: 1 }, byReviewStatus: { PENDING: 2 },
      })
    })

    it("uses the authenticated actor, rejects extra body fields, and returns bounded safe history", async () => {
      const inventory = app.container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
      const marker = uniqueMarker("proposal-review")
      const source = await inventory.createInventorySource({
        displayName: `Proposal review ${marker}`, provider: "PULSE", actor: "http-test", source: "MANUAL",
      })
      const proposal = await inventory.createInventoryProposal({
        inventorySourceId: source.id as string, tradingCardVariantId: `tcvar_${marker}`, changeKind: "NEW_HOLDING",
        previousQuantity: 0, proposedQuantity: 2, actor: "http-test", source: "MANUAL",
      })

      const rejectedExtraField = await app.postReviewInventoryProposal(
        proposal.id as string, { targetStatus: "APPROVED", actor: "client-forged" }, adminToken,
      )
      expect(rejectedExtraField.status).toBe(400)
      expect((await inventory.retrieveInventoryProposal(proposal.id as string)).review_status).toBe("PENDING")

      const reviewedResponse = await app.postReviewInventoryProposal(
        proposal.id as string, { targetStatus: "APPROVED", reviewNote: "checked" }, adminToken,
      )
      expect(reviewedResponse.status).toBe(200)
      expect((await reviewedResponse.json()).proposal).toMatchObject({ resolvedBy: "user_inventory_http_test", reviewNote: "checked" })

      const detailResponse = await app.getInventoryProposal(proposal.id as string, { limit: "2" }, adminToken)
      expect(detailResponse.status).toBe(200)
      const detail = await detailResponse.json()
      expect(detail.history.length).toBeLessThanOrEqual(2)
      expect(Object.keys(detail.history[0]).sort()).toEqual(["action", "actor", "createdAt", "id", "newValue", "oldValue", "reason", "source"])
      expect(detail.proposal).not.toHaveProperty("reconciliation_diagnostics")
      expect(detail.proposal).not.toHaveProperty("medusa_sync_attempt_token")
    })

    it("reports local apply success when Medusa fails and retry never duplicates the ledger movement", async () => {
      const inventory = app.container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
      const marker = uniqueMarker("proposal-apply")
      const source = await inventory.createInventorySource({
        displayName: `Proposal apply ${marker}`, provider: "PULSE", actor: "http-test", source: "MANUAL",
      })
      const proposal = await inventory.createInventoryProposal({
        inventorySourceId: source.id as string, tradingCardVariantId: `tcvar_${marker}`, changeKind: "NEW_HOLDING",
        previousQuantity: 0, proposedQuantity: 3, actor: "http-test", source: "MANUAL",
      })
      await inventory.reviewInventoryProposals({
        ids: [proposal.id as string], targetStatus: "APPROVED", actor: "http-test", source: "MANUAL",
      })

      const appliedResponse = await app.postApplyInventoryProposal(proposal.id as string, adminToken)
      expect(appliedResponse.status).toBe(200)
      expect((await appliedResponse.json()).result).toMatchObject({
        localApplicationStatus: "APPLIED", medusaSyncStatus: "FAILED", errorCode: null,
      })
      const [, beforeRetry] = await inventory.listAndCountInventoryTransactions({ originating_reference: proposal.id })
      expect(beforeRetry).toBe(1)

      const retryResponse = await app.postRetryInventoryProposalSync(proposal.id as string, adminToken)
      expect(retryResponse.status).toBe(502)
      expect((await retryResponse.json()).proposal).toMatchObject({ reviewStatus: "APPLIED", medusaSyncStatus: "FAILED" })
      const [, afterRetry] = await inventory.listAndCountInventoryTransactions({ originating_reference: proposal.id })
      expect(afterRetry).toBe(1)
    })
  })

  describe("publish readiness", () => {
    it("reports every blocker for a brand-new, unlinked variant", async () => {
      const { variant } = await createVariantFixture(uniqueMarker("readiness"))
      const response = await app.getPublishReadiness(variant.id, adminToken)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.ready).toBe(false)
      expect(body.blockers).toEqual(expect.arrayContaining([
        "NO_APPROVED_TCGDEX_DATA", "NO_READY_IMAGE", "NO_LINKED_PRODUCT", "ZERO_APPROVED_QUANTITY",
      ]))
    })
  })
})

describe("Admin trading-card-inventory Pulse import", () => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required for HTTP integration tests")
  const adminToken = generateJwtToken({
    actor_id: "user_pulse_import_http_test",
    actor_type: "user",
    auth_identity_id: "auth_pulse_import_http_test",
  }, { secret: process.env.JWT_SECRET, expiresIn: 3600 })

  const uniqueMarker = (label: string) =>
    `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`

  const CSV_HEADER =
    "Product Name,Set,Card Number,Material,Promo Info,Rarity,Graded By,Grade,Item Type,Product ID,Quantity,Avg Cost,Market Price,Sticker Price,Total Cost,Total Market Value,Total Sticker Value,Profit,Margin %,Markup vs Market %"

  function csvRow(productId: string, overrides: Record<string, string> = {}): string {
    const fields: Record<string, string> = {
      "Product Name": "Gengar", "Set": "Lost Origin", "Card Number": "066/196", "Material": "Holo",
      "Promo Info": "", "Rarity": "Rare", "Graded By": "", "Grade": "", "Item Type": "",
      "Product ID": productId, "Quantity": "2", "Avg Cost": "1.50", "Market Price": "3.00",
      "Sticker Price": "4.00", "Total Cost": "3.00", "Total Market Value": "6.00",
      "Total Sticker Value": "8.00", "Profit": "5.00", "Markup vs Market %": "50%",
      ...overrides,
    }
    const headers = CSV_HEADER.split(",")
    return headers.map((header) => fields[header] ?? "").join(",")
  }

  function csvContent(rows: string[]): string {
    return [CSV_HEADER, ...rows].join("\n")
  }

  async function createSource(displayName: string, overrides: Record<string, unknown> = {}) {
    const inventory = app.container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
    return inventory.createInventorySource({
      displayName, provider: "PULSE", actor: "http-test", source: "MANUAL", ...overrides,
    }) as Promise<Record<string, unknown>>
  }

  describe("authentication", () => {
    it("requires Admin authentication for every route", async () => {
      const responses = await Promise.all([
        app.postUploadCsv({ content: csvContent([csvRow(uniqueMarker("auth"))]), filename: "f.csv", mimeType: "text/csv" }, {}),
        app.getImportSnapshotSummary("tcisnap_missing"),
        app.getImportSnapshotEntries("tcisnap_missing", {}),
        app.getImportSnapshotDiagnostics("tcisnap_missing", {}),
        app.postRetryMatching("tcisnap_missing", {}),
        app.postReconcileSnapshot("tcisnap_missing", {}),
      ])
      expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401])
    })
  })

  describe("upload", () => {
    it("imports a fresh CSV against an existing active source", async () => {
      const marker = uniqueMarker("upload")
      const source = await createSource(`Upload Source ${marker}`)
      const response = await app.postUploadCsv(
        { content: csvContent([csvRow(`card:sv1|066/196|holo|nm-${marker}`)]), filename: "import.csv", mimeType: "text/csv" },
        { inventorySourceId: source.id as string },
        adminToken,
      )
      expect(response.status).toBe(201)
      const body = await response.json()
      expect(body.kind).toBe("IMPORTED")
      expect(body.inventorySourceId).toBe(source.id)
      expect(body.importSummary.rowCount).toBe(1)
    })

    it("creates a new source as part of the same upload request", async () => {
      const marker = uniqueMarker("newsource")
      const response = await app.postUploadCsv(
        { content: csvContent([csvRow(`card:sv1|066/196|holo|nm-${marker}`)]), filename: "import.csv", mimeType: "text/csv" },
        { newSourceDisplayName: `Pulse Export ${marker}`, newSourceProvider: "PULSE" },
        adminToken,
      )
      expect(response.status).toBe(201)
      const body = await response.json()
      expect(body.kind).toBe("IMPORTED")
      expect(typeof body.inventorySourceId).toBe("string")
    })

    it("detects a duplicate upload of the same file content against the same source", async () => {
      const marker = uniqueMarker("dup")
      const source = await createSource(`Duplicate Source ${marker}`)
      const content = csvContent([csvRow(`card:sv1|066/196|holo|nm-${marker}`)])
      const firstResponse = await app.postUploadCsv(
        { content, filename: "import.csv", mimeType: "text/csv" }, { inventorySourceId: source.id as string }, adminToken,
      )
      expect(firstResponse.status).toBe(201)
      const first = await firstResponse.json()

      const secondResponse = await app.postUploadCsv(
        { content, filename: "import.csv", mimeType: "text/csv" }, { inventorySourceId: source.id as string }, adminToken,
      )
      expect(secondResponse.status).toBe(200)
      const second = await secondResponse.json()
      expect(second).toMatchObject({ kind: "DUPLICATE", snapshotId: first.snapshotId })
    })

    it("converges concurrent duplicate uploads without duplicate rows, proposals, or diagnostics", async () => {
      const marker = uniqueMarker("concurrent-dup")
      const source = await createSource(`Concurrent Duplicate Source ${marker}`)
      const content = csvContent([csvRow(`card:sv1|066/196|holo|nm-${marker}`)])
      const responses = await Promise.all(Array.from({ length: 3 }, () => app.postUploadCsv(
        { content, filename: "import.csv", mimeType: "text/csv" }, { inventorySourceId: source.id as string }, adminToken,
      )))
      expect(responses.every((response) => [200, 201].includes(response.status))).toBe(true)
      const bodies = await Promise.all(responses.map((response) => response.json()))
      expect(new Set(bodies.map((body) => body.snapshotId)).size).toBe(1)
      const snapshotId = bodies[0].snapshotId as string

      const entries = await (await app.getImportSnapshotEntries(snapshotId, { limit: "100" }, adminToken)).json()
      expect(entries.count).toBe(1)
      const proposals = await (await app.getInventoryProposalSummary({ inventorySnapshotId: snapshotId }, adminToken)).json()
      expect(proposals.count).toBe(1)
      const diagnostics = await (await app.getImportSnapshotDiagnostics(snapshotId, { limit: "100" }, adminToken)).json()
      const identities = diagnostics.diagnostics.map((diagnostic: Record<string, unknown>) => JSON.stringify([
        diagnostic.snapshotEntryId, diagnostic.phase, diagnostic.code, diagnostic.severity, diagnostic.fieldRef, diagnostic.message,
      ]))
      expect(new Set(identities).size).toBe(identities.length)
    }, 60_000)

    it("rejects a malformed CSV before any snapshot is created", async () => {
      const marker = uniqueMarker("malformed")
      const source = await createSource(`Malformed Source ${marker}`)
      const response = await app.postUploadCsv(
        { content: "Product Name,Set\nGengar,Lost Origin", filename: "bad.csv", mimeType: "text/csv" },
        { inventorySourceId: source.id as string },
        adminToken,
      )
      expect(response.status).toBe(422)
      const body = await response.json()
      expect(body.kind).toBe("VALIDATION_FAILED")
    })

    it("rejects an unsupported MIME type", async () => {
      const marker = uniqueMarker("mime")
      const source = await createSource(`MIME Source ${marker}`)
      const response = await app.postUploadCsv(
        { content: csvContent([csvRow(`card:sv1|066/196|holo|nm-${marker}`)]), filename: "import.csv", mimeType: "application/pdf" },
        { inventorySourceId: source.id as string },
        adminToken,
      )
      expect(response.status).toBe(422)
      expect((await response.json()).kind).toBe("VALIDATION_FAILED")
    })

    it("rejects a file over the 10 MB limit before it reaches the workflow", async () => {
      const marker = uniqueMarker("oversized")
      const source = await createSource(`Oversized Source ${marker}`)
      const oversizedRow = csvRow(`card:sv1|066/196|holo|nm-${marker}`, { "Product Name": "G".repeat(11 * 1024 * 1024) })
      const response = await app.postUploadCsv(
        { content: csvContent([oversizedRow]), filename: "big.csv", mimeType: "text/csv" },
        { inventorySourceId: source.id as string },
        adminToken,
      )
      expect(response.status).toBe(413)
    }, 60_000)

    it("bounds multipart field count and field size", async () => {
      const file = { content: csvContent([csvRow(uniqueMarker("multipart"))]), filename: "import.csv", mimeType: "text/csv" }
      const tooManyFields = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`field${index}`, "x"]))
      const countResponse = await app.postUploadCsv(file, tooManyFields, adminToken)
      expect(countResponse.status).toBe(400)
      expect((await countResponse.json()).code).toMatch(/LIMIT_(FIELD_COUNT|PART_COUNT)/)

      const sizeResponse = await app.postUploadCsv(file, { inventorySourceId: "x".repeat(1_025) }, adminToken)
      expect(sizeResponse.status).toBe(400)
      expect((await sizeResponse.json()).code).toBe("LIMIT_FIELD_VALUE")
    })

    it("rejects an upload against an archived source", async () => {
      const marker = uniqueMarker("archived")
      const source = await createSource(`Archived Source ${marker}`)
      const inventory = app.container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
      await inventory.archiveInventorySource({ id: source.id as string, actor: "http-test", source: "MANUAL" })
      const response = await app.postUploadCsv(
        { content: csvContent([csvRow(`card:sv1|066/196|holo|nm-${marker}`)]), filename: "import.csv", mimeType: "text/csv" },
        { inventorySourceId: source.id as string },
        adminToken,
      )
      expect(response.status).toBe(409)
      expect((await response.json()).kind).toBe("SOURCE_ARCHIVED")
    })
  })

  describe("snapshot summary, entries and diagnostics", () => {
    async function uploadFixture(marker: string) {
      const source = await createSource(`Fixture Source ${marker}`)
      const rows = [
        csvRow(`card:sv1|066/196|holo|nm-${marker}-a`),
        csvRow(`card:sv1|999/196|holo|nm-${marker}-b`, { "Rarity": "Some Unmapped Rarity" }),
      ]
      const response = await app.postUploadCsv(
        { content: csvContent(rows), filename: "import.csv", mimeType: "text/csv" },
        { inventorySourceId: source.id as string },
        adminToken,
      )
      const body = await response.json()
      return { source, snapshotId: body.snapshotId as string }
    }

    it("returns a bounded, allow-listed summary", async () => {
      const { snapshotId } = await uploadFixture(uniqueMarker("summary"))
      const response = await app.getImportSnapshotSummary(snapshotId, adminToken)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.summary).toMatchObject({ snapshotId, rowCount: 2 })
      expect(body.summary.inventorySourceDisplayName).toMatch(/Fixture Source/)
      expect(body.summary.raw_fields).toBeUndefined()
    })

    it("paginates and filters the entry list without leaking raw fields", async () => {
      const { snapshotId } = await uploadFixture(uniqueMarker("entries"))
      const allResponse = await app.getImportSnapshotEntries(snapshotId, { limit: "1", offset: "0" }, adminToken)
      expect(allResponse.status).toBe(200)
      const allBody = await allResponse.json()
      expect(allBody).toMatchObject({ count: 2, limit: 1, offset: 0 })
      expect(allBody.entries).toHaveLength(1)
      expect(Object.keys(allBody.entries[0])).not.toContain("raw_fields")
      expect(Object.keys(allBody.entries[0]).sort()).toEqual([
        "card", "cardIdentityHint", "conditionCandidate", "conditionSource", "currencyCode", "finishCandidate", "id",
        "languageConflict", "matchedVia", "matchingStatus", "outcome", "providerReference", "quantity",
        "rarityCandidate", "rarityRaw", "retryCount", "rowNumber", "specialTreatmentCandidate", "tcgdexCandidate",
        "tradingCardVariantId",
        "unitAcquisitionCost", "unitMarketPrice", "unitSellingPrice",
      ].sort())

      const invalidResponse = await app.getImportSnapshotEntries(snapshotId, { limit: "not-a-number" }, adminToken)
      expect(invalidResponse.status).toBe(400)
    })

    it("paginates and filters diagnostics by severity", async () => {
      const { snapshotId } = await uploadFixture(uniqueMarker("diagnostics"))
      const response = await app.getImportSnapshotDiagnostics(snapshotId, { severity: "WARNING", limit: "50" }, adminToken)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.count).toBeGreaterThanOrEqual(1)
      for (const diagnostic of body.diagnostics) {
        expect(diagnostic.severity).toBe("WARNING")
        expect(Object.keys(diagnostic).sort()).toEqual(["code", "fieldRef", "id", "message", "phase", "rowNumber", "severity", "snapshotEntryId"])
      }
    })
  })

  describe("retry matching", () => {
    it("re-runs matching for an already-persisted snapshot via the dedicated retry workflow", async () => {
      const marker = uniqueMarker("retry")
      const source = await createSource(`Retry Source ${marker}`)
      const uploadResponse = await app.postUploadCsv(
        { content: csvContent([csvRow(`card:sv1|066/196|holo|nm-${marker}`)]), filename: "import.csv", mimeType: "text/csv" },
        { inventorySourceId: source.id as string },
        adminToken,
      )
      const { snapshotId } = await uploadResponse.json()

      const pgConnection = app.container.resolve<{ raw: (query: string) => Promise<{ rows: Array<Record<string, string>> }> }>(
        ContainerRegistrationKeys.PG_CONNECTION,
      )
      const mutationCounts = async () => (await pgConnection.raw(
        `select
           (select count(*)::text from trading_card_inventory_holding where deleted_at is null) as holdings,
           (select count(*)::text from inventory_item where deleted_at is null) as inventory_items,
           (select count(*)::text from inventory_level where deleted_at is null) as inventory_levels,
           (select count(*)::text from product where deleted_at is null and status = 'published') as published_products`,
      )).rows[0]
      const beforeRetry = await mutationCounts()

      const response = await app.postRetryMatching(snapshotId, { reason: "manual retry check" }, adminToken)
      expect(response.status).toBe(200)
      expect((await response.json()).kind).toBe("IMPORTED")
      expect(await mutationCounts()).toEqual(beforeRetry)
    })

    it("returns a safe not-found for a missing snapshot", async () => {
      const response = await app.postRetryMatching("tcisnap_missing", {}, adminToken)
      expect(response.status).toBe(404)
    })
  })

  describe("reconciliation trigger", () => {
    it("reconciles a VALIDATED snapshot that was never automatically reconciled", async () => {
      const inventory = app.container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
      const marker = uniqueMarker("reconcile")
      const source = await createSource(`Reconcile Source ${marker}`)
      const snapshot = await inventory.createInventorySnapshot({
        inventorySourceId: source.id as string, actor: "http-test", source: "MANUAL",
      }) as Record<string, unknown>
      await inventory.addInventorySnapshotEntries({
        snapshotId: snapshot.id as string, actor: "http-test", source: "MANUAL", entries: [
          { providerReference: `${marker}-a`, providerReferenceType: "PULSE_PRODUCT_ID", tradingCardVariantId: null, quantity: 1, currencyCode: "GBP", unitAcquisitionCost: "1", unitMarketPrice: "2", unitSellingPrice: "3" },
        ],
      })
      await inventory.transitionInventorySnapshotStatus({ id: snapshot.id as string, targetStatus: "VALIDATED", actor: "http-test", source: "MANUAL" })

      const response = await app.postReconcileSnapshot(snapshot.id as string, {}, adminToken)
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.summary).toMatchObject({ snapshotId: snapshot.id, status: "PENDING_REVIEW", proposalCount: 1 })
    })

    it("rejects reconciliation for a snapshot that is not in a recoverable state", async () => {
      const inventory = app.container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
      const marker = uniqueMarker("reconcile-draft")
      const source = await createSource(`Reconcile Draft Source ${marker}`)
      const snapshot = await inventory.createInventorySnapshot({
        inventorySourceId: source.id as string, actor: "http-test", source: "MANUAL",
      }) as Record<string, unknown>

      const response = await app.postReconcileSnapshot(snapshot.id as string, {}, adminToken)
      expect(response.status).toBe(400)
    })

    it("rejects an invalid or unapproved baseline instead of silently ignoring it", async () => {
      const inventory = app.container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
      const marker = uniqueMarker("reconcile-baseline")
      const source = await createSource(`Reconcile Baseline Source ${marker}`)
      const snapshot = await inventory.createInventorySnapshot({
        inventorySourceId: source.id as string, actor: "http-test", source: "MANUAL",
      }) as Record<string, unknown>
      await inventory.transitionInventorySnapshotStatus({ id: snapshot.id as string, targetStatus: "VALIDATED", actor: "http-test", source: "MANUAL" })

      const response = await app.postReconcileSnapshot(
        snapshot.id as string, { previousApprovedSnapshotId: "tcisnap_not_a_real_baseline" }, adminToken,
      )
      expect(response.status).toBe(400)
    })
  })
})

describe("POST /admin/trading-cards/create-from-inventory-row", () => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required for HTTP integration tests")
  const adminToken = generateJwtToken({
    actor_id: "user_create_card_http_test",
    actor_type: "user",
    auth_identity_id: "auth_create_card_http_test",
  }, { secret: process.env.JWT_SECRET, expiresIn: 3600 })

  const uniqueMarker = (label: string) =>
    `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`

  const postCreateCard = (body: unknown, authenticated = true) => fetch(`${app.baseUrl}/admin/trading-cards/create-from-inventory-row`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authenticated ? { authorization: `Bearer ${adminToken}` } : {}),
    },
    body: JSON.stringify(body),
  })

  async function ensureStockLocation() {
    const stockLocations = app.container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
    const [existing] = await stockLocations.listStockLocations({})
    if (existing) return existing
    return stockLocations.createStockLocations({ name: `Create Card HTTP Test Location ${uniqueMarker("loc")}` })
  }

  /**
   * Builds an UNRESOLVED_VARIANT proposal the same way the real Pulse
   * pipeline reaches one: a null-variant entry, an UNMATCHED match row for
   * it, then reconciliation. Uses `app.getInventoryProposals` (a real
   * authenticated HTTP call) rather than a raw service list, so the
   * fixture itself exercises the same allow-listed read path the Admin UI
   * uses.
   */
  async function unresolvedVariantProposalFixture(marker: string, overrides: { cardNumber?: string; setCode?: string } = {}) {
    const inventory = app.container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
    const source = await inventory.createInventorySource({
      displayName: `Create Card HTTP Source ${marker}`, provider: "PULSE", language: "EN", actor: "http-test", source: "MANUAL",
    }) as Record<string, unknown>
    const snapshot = await inventory.createInventorySnapshot({
      inventorySourceId: source.id as string, actor: "http-test", source: "MANUAL",
    }) as Record<string, unknown>
    const cardNumber = overrides.cardNumber ?? "066/196"
    const setCode = overrides.setCode ?? `sv1-${marker}`
    const providerReference = `card:${setCode}|${cardNumber}|holo|null|null|null`
    await inventory.addInventorySnapshotEntries({
      snapshotId: snapshot.id as string, actor: "http-test", source: "MANUAL",
      entries: [{
        providerReference, providerReferenceType: "PULSE_PRODUCT_ID", tradingCardVariantId: null,
        quantity: 2, currencyCode: "GBP", unitAcquisitionCost: "1.00", unitMarketPrice: "2.00", unitSellingPrice: "3.00",
      }],
    })
    await inventory.transitionInventorySnapshotStatus({ id: snapshot.id as string, targetStatus: "VALIDATED", actor: "http-test", source: "MANUAL" })
    const [entry] = await inventory.listInventorySnapshotEntries({
      inventory_snapshot_id: snapshot.id as string, provider_reference: providerReference,
    }) as Record<string, unknown>[]
    await inventory.recordSnapshotEntryMatch({
      snapshotEntryId: entry.id as string, inventorySnapshotId: snapshot.id as string,
      matchingStatus: "UNMATCHED", matchedVia: "NONE", diagnostics: [], actor: "http-test", source: "SYSTEM",
    })
    await inventory.reconcileInventorySnapshot({
      inventorySourceId: source.id as string, snapshotId: snapshot.id as string, actor: "reconciler", source: "SYSTEM",
    })
    const proposalsResponse = await app.getInventoryProposals({
      inventorySnapshotId: snapshot.id as string, changeKind: "UNRESOLVED_VARIANT",
    }, adminToken)
    const proposalsBody = await proposalsResponse.json()
    return { source, snapshot, entry, proposal: proposalsBody.proposals[0], providerReference, cardNumber }
  }

  function createCardBody(proposalId: string, marker: string, overrides: Record<string, unknown> = {}) {
    return {
      inventoryProposalId: proposalId,
      cardSetDisplayName: `Test Set ${marker}`,
      name: `Test Card ${marker}`,
      cardNumber: "066/196",
      rarityRaw: null,
      condition: "NEAR_MINT",
      finish: "HOLO",
      specialTreatment: "NONE",
      finishConfirmed: true,
      specialTreatmentConfirmed: true,
      ...overrides,
    }
  }

  beforeAll(async () => {
    await ensureStockLocation()
  })

  it("requires Admin authentication", async () => {
    const response = await postCreateCard(createCardBody("tciprop_missing", "auth"), false)
    expect(response.status).toBe(401)
  })

  it("creates the card, resolves the proposal, and triggers TCGdex enrichment — retrievable through Medusa's normal APIs", async () => {
    const marker = uniqueMarker("roundtrip")
    const { proposal } = await unresolvedVariantProposalFixture(marker)
    app.tcgdexClient.enqueueError(new TcgDexError({ code: TCGDEX_ERROR_CODE.NOT_FOUND, message: "no match", operation: "getCardBySetAndLocalId" }))

    const response = await postCreateCard(createCardBody(proposal.id, marker))
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.idempotentReplay).toBe(false)
    expect(body.result).toMatchObject({
      card: { name: `Test Card ${marker}`, setDisplayName: `Test Set ${marker}`, cardNumber: "066/196", condition: "NEAR_MINT", finish: "HOLO", specialTreatment: "NONE" },
    })
    expect(typeof body.result.tradingCardVariantId).toBe("string")
    expect(typeof body.result.tradingCardId).toBe("string")

    // The proposal is now resolved, not still sitting UNRESOLVED_VARIANT.
    const inventory = app.container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
    const refreshedProposal = await inventory.retrieveInventoryProposal(proposal.id)
    expect(refreshedProposal).toMatchObject({ change_kind: "NEW_HOLDING", trading_card_variant_id: body.result.tradingCardVariantId })

    // The full Medusa linkage is retrievable via the exact query.graph hop
    // Stage 5B.2's own inventory sync uses — proving the ProductOption
    // audit-fix rewrite (official module-service APIs, not raw SQL) leaves
    // a fully valid, normally-queryable Product/ProductVariant/InventoryItem
    // chain, not just a workflow-internal success.
    const query = app.container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "trading_card_variant",
      fields: ["id", "product_variant.id", "product_variant.sku", "product_variant.inventory_items.inventory_item_id"],
      filters: { id: body.result.tradingCardVariantId },
    })
    const productVariant = data[0]?.product_variant as { id?: string; inventory_items?: Array<{ inventory_item_id?: string }> } | null
    expect(productVariant?.id).toEqual(expect.any(String))
    expect(productVariant?.inventory_items?.[0]?.inventory_item_id).toEqual(expect.any(String))

    const { data: variantOwner } = await query.graph({
      entity: "product_variant", fields: ["id", "product.id"], filters: { id: productVariant?.id as string },
    })
    const ownerProductId = (variantOwner[0]?.product as { id: string }).id

    // Retrievable through the plain product module service too — confirms
    // the option/value/pivot rows the workaround wrote are visible outside
    // the request that wrote them, not merely returned optimistically from
    // the same call (this was the exact persistence quirk the audit found
    // with the module service's own `updateProductOptions` path).
    const products = app.container.resolve<IProductModuleService>(Modules.PRODUCT)
    const ownerProduct = await products.retrieveProduct(ownerProductId, { relations: ["options", "options.values"] })
    const cardVariantOption = ownerProduct.options?.find((option) => option.title === "Card Variant")
    expect(cardVariantOption).toBeDefined()
    expect(cardVariantOption?.values?.some((value) => value.value.includes("NEAR MINT"))).toBe(true)

    // TCGdex returning "not found" is a completed, recorded attempt, not a
    // thrown error — retryTcgdexEnrichmentMatch resolves normally either
    // way, so TRIGGERED is correct here (FAILED_TO_TRIGGER means the call
    // itself couldn't be made, e.g. missing card-set identity).
    expect(app.tcgdexClient.calls.length).toBeGreaterThan(0)
    expect(body.result.tcgdexEnrichmentStatus).toBe("TRIGGERED")
  })

  it("is idempotent on replay — returns the same variant with idempotentReplay: true", async () => {
    const marker = uniqueMarker("replay")
    const { proposal } = await unresolvedVariantProposalFixture(marker)
    app.tcgdexClient.enqueueError(new TcgDexError({ code: TCGDEX_ERROR_CODE.NOT_FOUND, message: "no match", operation: "getCardBySetAndLocalId" }))

    const first = await postCreateCard(createCardBody(proposal.id, marker))
    expect(first.status).toBe(201)
    const firstBody = await first.json()

    const second = await postCreateCard(createCardBody(proposal.id, marker))
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    expect(secondBody.idempotentReplay).toBe(true)
    expect(secondBody.result.tradingCardVariantId).toBe(firstBody.result.tradingCardVariantId)
  })

  it("returns 409 while another attempt holds the creation claim", async () => {
    const marker = uniqueMarker("inprogress")
    const { proposal } = await unresolvedVariantProposalFixture(marker)
    const inventory = app.container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
    await inventory.beginCardCreationClaim({ proposalId: proposal.id, actor: "another-reviewer", source: "MANUAL" })

    const response = await postCreateCard(createCardBody(proposal.id, marker))
    expect(response.status).toBe(409)
  })

  it("reuses the existing Product when a second row adds a new variant to the same card", async () => {
    const marker = uniqueMarker("reuse")
    const setCode = `sv1-${marker}`
    const first = await unresolvedVariantProposalFixture(`${marker}-a`, { cardNumber: "077/196", setCode })
    const second = await unresolvedVariantProposalFixture(`${marker}-b`, { cardNumber: "077/196", setCode })
    app.tcgdexClient.enqueueError(new TcgDexError({ code: TCGDEX_ERROR_CODE.NOT_FOUND, message: "no match", operation: "getCardBySetAndLocalId" }))
    app.tcgdexClient.enqueueError(new TcgDexError({ code: TCGDEX_ERROR_CODE.NOT_FOUND, message: "no match", operation: "getCardBySetAndLocalId" }))

    const firstResponse = await postCreateCard(createCardBody(first.proposal.id, marker, {
      cardSetDisplayName: `Reuse Set ${marker}`, name: `Reuse Card ${marker}`, cardNumber: "077/196",
      condition: "NEAR_MINT", finish: "HOLO",
    }))
    expect(firstResponse.status).toBe(201)
    const firstBody = await firstResponse.json()

    const secondResponse = await postCreateCard(createCardBody(second.proposal.id, marker, {
      cardSetDisplayName: `Reuse Set ${marker}`, name: `Reuse Card ${marker}`, cardNumber: "077/196",
      condition: "LIGHTLY_PLAYED", finish: "HOLO",
    }))
    expect(secondResponse.status).toBe(201)
    const secondBody = await secondResponse.json()

    expect(secondBody.result.tradingCardId).toBe(firstBody.result.tradingCardId)
    expect(secondBody.result.tradingCardVariantId).not.toBe(firstBody.result.tradingCardVariantId)

    const query = app.container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "trading_card", fields: ["id", "product.id"], filters: { id: firstBody.result.tradingCardId },
    })
    const productId = (data[0]?.product as { id: string }).id
    const { data: variantsOfProduct } = await query.graph({
      entity: "product_variant", fields: ["id"], filters: { product_id: productId },
    })
    expect(variantsOfProduct).toHaveLength(2)
  })

  describe("damaged existing catalogue links are repaired, not fatal (ADR 0013)", () => {
    /**
     * Deliberately dismisses the `TRADING_CARDS_MODULE`
     * `trading_card_id` <-> `PRODUCT` `product_id` link that
     * `ensureProductChainForTradingCard` relies on, simulating a manually-
     * or partially-repaired catalogue where the TradingCard row survived
     * but its Medusa Product link did not.
     */
    async function breakTradingCardProductLink(tradingCardId: string, productId: string) {
      const link = app.container.resolve(ContainerRegistrationKeys.LINK)
      await link.dismiss({
        [Modules.PRODUCT]: { product_id: productId },
        [TRADING_CARDS_MODULE]: { trading_card_id: tradingCardId },
      })
    }

    it("repairs a broken TradingCard <-> Product link by creating and linking a fresh Product, reusing the same TradingCard", async () => {
      const marker = uniqueMarker("brokenlink")
      const setCode = `sv1-${marker}`
      const cardNumber = "088/196"

      const first = await unresolvedVariantProposalFixture(`${marker}-a`, { cardNumber, setCode })
      app.tcgdexClient.enqueueError(new TcgDexError({ code: TCGDEX_ERROR_CODE.NOT_FOUND, message: "no match", operation: "getCardBySetAndLocalId" }))
      const firstResponse = await postCreateCard(createCardBody(first.proposal.id, marker, {
        cardSetDisplayName: `Broken Link Set ${marker}`, name: `Broken Link Card ${marker}`, cardNumber,
      }))
      expect(firstResponse.status).toBe(201)
      const firstBody = await firstResponse.json()
      const tradingCardId = firstBody.result.tradingCardId as string

      const query = app.container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: beforeBreak } = await query.graph({
        entity: "trading_card", fields: ["id", "product.id"], filters: { id: tradingCardId },
      })
      const originalProductId = (beforeBreak[0]?.product as { id: string }).id
      await breakTradingCardProductLink(tradingCardId, originalProductId)

      const products = app.container.resolve<IProductModuleService>(Modules.PRODUCT)
      app.tcgdexClient.enqueueError(new TcgDexError({ code: TCGDEX_ERROR_CODE.NOT_FOUND, message: "no match", operation: "getCardBySetAndLocalId" }))

      // A second row for the SAME card identity (same set/number) resolves
      // the existing TradingCard, finds its Product link missing, and
      // repairs it rather than failing — a fresh Product is created and
      // linked (the original, now-unlinked one has no reverse identity this
      // workflow can safely rediscover it by, so it is left behind as a
      // deferred-reconciliation orphan — see ADR 0013).
      const second = await unresolvedVariantProposalFixture(`${marker}-b`, { cardNumber, setCode })
      const secondResponse = await postCreateCard(createCardBody(second.proposal.id, marker, {
        cardSetDisplayName: `Broken Link Set ${marker}`, name: `Broken Link Card ${marker}`, cardNumber,
        condition: "LIGHTLY_PLAYED",
      }))
      expect(secondResponse.status).toBe(201)
      const secondBody = await secondResponse.json()

      // The TradingCard identity is reused, never duplicated.
      expect(secondBody.result.tradingCardId).toBe(tradingCardId)

      const { data: afterRepair } = await query.graph({
        entity: "trading_card", fields: ["id", "product.id"], filters: { id: tradingCardId },
      })
      const repairedProductId = (afterRepair[0]?.product as { id: string }).id
      expect(repairedProductId).toBeTruthy()
      // A fresh Product was created for the repair — not the original,
      // still-orphaned one (verifying real repair happened, not a no-op).
      expect(repairedProductId).not.toBe(originalProductId)
      await expect(products.retrieveProduct(repairedProductId)).resolves.toMatchObject({ id: repairedProductId })
      // The original, now-permanently-unlinked Product is left behind, not
      // deleted — the accepted, documented residual (ADR 0013).
      await expect(products.retrieveProduct(originalProductId)).resolves.toMatchObject({ id: originalProductId })

      // The second proposal resolved to a real, complete chain.
      const inventory = app.container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
      const refreshedSecondProposal = await inventory.retrieveInventoryProposal(second.proposal.id)
      expect(refreshedSecondProposal).toMatchObject({ change_kind: "NEW_HOLDING", card_creation_claim_token: null })
    })

    it("repairs a broken TradingCardVariant <-> ProductVariant link by restoring the exact original ProductVariant, never creating a duplicate", async () => {
      const marker = uniqueMarker("brokenvariant")
      const setCode = `sv1-${marker}`
      const cardNumber = "099/196"

      const first = await unresolvedVariantProposalFixture(`${marker}-a`, { cardNumber, setCode })
      app.tcgdexClient.enqueueError(new TcgDexError({ code: TCGDEX_ERROR_CODE.NOT_FOUND, message: "no match", operation: "getCardBySetAndLocalId" }))
      const firstResponse = await postCreateCard(createCardBody(first.proposal.id, marker, {
        cardSetDisplayName: `Broken Variant Set ${marker}`, name: `Broken Variant Card ${marker}`, cardNumber,
      }))
      expect(firstResponse.status).toBe(201)
      const firstBody = await firstResponse.json()
      const tradingCardVariantId = firstBody.result.tradingCardVariantId as string

      const query = app.container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: beforeBreak } = await query.graph({
        entity: "trading_card_variant", fields: ["id", "product_variant.id"], filters: { id: tradingCardVariantId },
      })
      const productVariantId = (beforeBreak[0]?.product_variant as { id: string }).id
      const link = app.container.resolve(ContainerRegistrationKeys.LINK)
      await link.dismiss({
        [Modules.PRODUCT]: { product_variant_id: productVariantId },
        [TRADING_CARDS_MODULE]: { trading_card_variant_id: tradingCardVariantId },
      })

      const products = app.container.resolve<IProductModuleService>(Modules.PRODUCT)
      const variantsBeforeSecondAttempt = await products.listProductVariants({})

      // A second row for the SAME (card, condition, finish, treatment)
      // tuple resolves to the existing TradingCardVariant, finds its
      // ProductVariant link missing, and repairs it. Medusa allows at most
      // one variant per option-value combination on a product, so the
      // *original* ProductVariant (never deleted, just unlinked) is the
      // only one `ensureProductVariantForDimensions` can find — repair
      // here means restoring the original link, not creating a new variant.
      const second = await unresolvedVariantProposalFixture(`${marker}-b`, { cardNumber, setCode })
      const secondResponse = await postCreateCard(createCardBody(second.proposal.id, marker, {
        cardSetDisplayName: `Broken Variant Set ${marker}`, name: `Broken Variant Card ${marker}`, cardNumber,
      }))
      expect(secondResponse.status).toBe(201)
      const secondBody = await secondResponse.json()

      // The TradingCardVariant identity is reused, never duplicated.
      expect(secondBody.result.tradingCardVariantId).toBe(tradingCardVariantId)
      // The exact original ProductVariant was restored — no new one created.
      const { data: afterRepair } = await query.graph({
        entity: "trading_card_variant", fields: ["id", "product_variant.id"], filters: { id: tradingCardVariantId },
      })
      expect((afterRepair[0]?.product_variant as { id: string }).id).toBe(productVariantId)

      const variantsAfterSecondAttempt = await products.listProductVariants({})
      expect(variantsAfterSecondAttempt).toHaveLength(variantsBeforeSecondAttempt.length)

      const inventory = app.container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
      const refreshedSecondProposal = await inventory.retrieveInventoryProposal(second.proposal.id)
      expect(refreshedSecondProposal).toMatchObject({ change_kind: "NEW_HOLDING", card_creation_claim_token: null })
    })
  })

  // Phase 8: every reviewer confirmation and the card-number shape must be
  // enforced by the server itself — a disabled button or unchecked box on
  // the client stops nothing against a direct API call. Each case below
  // asserts a clean 400 (schema rejection, before any workflow/database
  // round-trip) and that no CardSet/TradingCard/Product was created.
  describe("server-side confirmation and card-number enforcement (Phase 8)", () => {
    async function expectNoCardCreated(proposalId: string) {
      const inventory = app.container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
      const refreshedProposal = await inventory.retrieveInventoryProposal(proposalId)
      expect(refreshedProposal).toMatchObject({ change_kind: "UNRESOLVED_VARIANT", trading_card_variant_id: null })
    }

    it("rejects a request with finishConfirmed: false", async () => {
      const marker = uniqueMarker("finish-false")
      const { proposal } = await unresolvedVariantProposalFixture(marker)

      const response = await postCreateCard(createCardBody(proposal.id, marker, { finishConfirmed: false }))
      expect(response.status).toBe(400)
      await expectNoCardCreated(proposal.id)
    })

    it("rejects a request that omits finishConfirmed entirely", async () => {
      const marker = uniqueMarker("finish-missing")
      const { proposal } = await unresolvedVariantProposalFixture(marker)
      const body = createCardBody(proposal.id, marker) as Record<string, unknown>
      delete body.finishConfirmed

      const response = await postCreateCard(body)
      expect(response.status).toBe(400)
      await expectNoCardCreated(proposal.id)
    })

    it("rejects a request with specialTreatmentConfirmed: false", async () => {
      const marker = uniqueMarker("treatment-false")
      const { proposal } = await unresolvedVariantProposalFixture(marker)

      const response = await postCreateCard(createCardBody(proposal.id, marker, { specialTreatmentConfirmed: false }))
      expect(response.status).toBe(400)
      await expectNoCardCreated(proposal.id)
    })

    it("rejects a request where confirmation flags are truthy but not the literal boolean true", async () => {
      const marker = uniqueMarker("truthy-not-true")
      const { proposal } = await unresolvedVariantProposalFixture(marker)

      // "true", 1 — the shapes a hand-crafted request bypassing the UI's
      // disabled-button/checkbox affordance might plausibly send.
      const response = await postCreateCard(createCardBody(proposal.id, marker, { finishConfirmed: "true", specialTreatmentConfirmed: 1 }))
      expect(response.status).toBe(400)
      await expectNoCardCreated(proposal.id)
    })

    it.each([
      ["embedded whitespace", "1 2"],
      ["multiple slashes", "12/34/56"],
      ["multiple suffix letters", "025ab"],
      ["non-numeric denominator", "025/ab"],
      ["empty string", ""],
    ])("rejects a malformed card number (%s: %j)", async (_label, badCardNumber) => {
      const marker = uniqueMarker("bad-number")
      const { proposal } = await unresolvedVariantProposalFixture(marker)

      const response = await postCreateCard(createCardBody(proposal.id, marker, { cardNumber: badCardNumber }))
      expect(response.status).toBe(400)
      await expectNoCardCreated(proposal.id)
    })

    it("accepts a card number with leading zeros and a single-letter suffix", async () => {
      const marker = uniqueMarker("suffix-ok")
      const { proposal } = await unresolvedVariantProposalFixture(marker)
      app.tcgdexClient.enqueueError(new TcgDexError({ code: TCGDEX_ERROR_CODE.NOT_FOUND, message: "no match", operation: "getCardBySetAndLocalId" }))

      const response = await postCreateCard(createCardBody(proposal.id, marker, { cardNumber: "025a" }))
      expect(response.status).toBe(201)
      const body = await response.json()
      expect(body.result.card.cardNumber).toBe("025a")
    })

    it("rejects an unconfirmed request even when the proposal itself is otherwise valid and unclaimed", async () => {
      // Confirms rejection happens before the claim/workflow is ever
      // touched: the proposal is left completely untouched (no claim taken,
      // still UNRESOLVED_VARIANT), not merely "not resolved to a variant".
      const marker = uniqueMarker("unconfirmed-untouched")
      const { proposal } = await unresolvedVariantProposalFixture(marker)

      const response = await postCreateCard(createCardBody(proposal.id, marker, { finishConfirmed: false, specialTreatmentConfirmed: false }))
      expect(response.status).toBe(400)

      const inventory = app.container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
      const refreshedProposal = await inventory.retrieveInventoryProposal(proposal.id)
      expect(refreshedProposal).toMatchObject({ change_kind: "UNRESOLVED_VARIANT", trading_card_variant_id: null, card_creation_claim_token: null })
    })
  })
})
