import { checkRateLimit, type RateLimitBucketStore } from "../../../../modules/newsletter/rate-limit/rate-limiter"
import type { RateLimitConfig } from "../../../../modules/newsletter/rate-limit/config"
import type { RecaptchaVerifier } from "../../../../modules/newsletter/recaptcha/verify"
import {
  sendConfirmationEmailWithProtections,
  type ConfirmationEmailDeliveryStore,
} from "../../../../modules/newsletter/resend/delivery"
import type { ConfirmationEmailSender } from "../../../../modules/newsletter/resend/sender"
import type { ResendConfig } from "../../../../modules/newsletter/resend/config"
import type { PrepareSubscriptionInput, SignupResult } from "../../../../modules/newsletter/lifecycle/types"
import { NEWSLETTER_CONSENT_TEXT_VERSION, NEWSLETTER_SIGNUP_SOURCE } from "./consent"
import type { ClientAddressResult } from "../../../../modules/newsletter/rate-limit/client-address"

/** The narrow store contract this orchestrator needs — satisfied by `NewsletterModuleService` in production, a plain fake in tests. */
export interface SubscribeOrchestratorStore extends RateLimitBucketStore, ConfirmationEmailDeliveryStore {
  prepareSubscription(input: PrepareSubscriptionInput): Promise<SignupResult>
}

export interface SubscribeOrchestratorDeps {
  store: SubscribeOrchestratorStore
  recaptchaVerifier: RecaptchaVerifier
  emailSender: ConfirmationEmailSender
  rateLimitConfig: RateLimitConfig
  emailConfig: Pick<
    ResendConfig,
    "storefrontBaseUrl" | "confirmationEmailCooldownSeconds" | "confirmationEmailStaleReservationSeconds"
  >
  clientAddress: ClientAddressResult
  /** Injected only for deterministic tests; production always uses `new Date()`. */
  now?: Date
}

export interface SubscribeOrchestratorInput {
  firstName: string
  email: string
  /** Present and non-empty only when the honeypot field was filled by a bot. */
  honeypot?: string
  recaptchaToken: string
  countryCode: string
}

export type SubscribeOrchestratorResult =
  | { kind: "RATE_LIMITED"; retryAfterSeconds: number }
  | { kind: "RECAPTCHA_FAILED"; providerUnavailable: boolean }
  | { kind: "ACCEPTED" }

/**
 * Coordinates one `POST /store/newsletter/subscribe` submission, following
 * the processing order fixed by docs/decisions/0005-newsletter-backend-design.md
 * (Stage 2C.6 notes):
 *
 * 1. Rate limit (fails closed if the client address itself was not
 *    trusted/extractable, or on any limiter failure) — this runs before the
 *    honeypot check, so a filled-honeypot request still consumes a rate-limit
 *    attempt rather than becoming a free, unlimited request-flood path.
 * 2. Honeypot — a filled honeypot silently short-circuits with `ACCEPTED`:
 *    no subscriber lookup/mutation, no reCAPTCHA call, no email.
 * 3. reCAPTCHA verification.
 * 4. The subscriber lifecycle operation (`prepareSubscription`).
 * 5. A confirmation-email attempt, only when the lifecycle result actually
 *    (re)issued a token (`PENDING_CREATED`/`PENDING_REFRESHED`) — an
 *    `ALREADY_CONFIRMED` result sends nothing.
 *
 * The email-delivery outcome (`SENT`/`SUPPRESSED_COOLDOWN`/`FAILED`/
 * `AMBIGUOUS`/...) is deliberately discarded here rather than surfaced as a
 * distinct route outcome: the brief allows (but does not require) mapping a
 * definitive Resend failure to a distinct temporary-failure response, and
 * doing so would make the HTTP response an oracle correlated with whether
 * the submitted address is a real, deliverable inbox. Every reachable path
 * past reCAPTCHA verification returns `ACCEPTED`; subscriber state itself
 * (PENDING/CONFIRMED, `confirmation_send_state`) still faithfully reflects
 * what happened, per the lifecycle/delivery modules' own guarantees.
 */
export async function orchestrateNewsletterSubscription(
  input: SubscribeOrchestratorInput,
  deps: SubscribeOrchestratorDeps
): Promise<SubscribeOrchestratorResult> {
  const now = deps.now ?? new Date()

  if (!deps.clientAddress.ok) {
    // No trusted address to key a rate-limit bucket on — fail closed the
    // same way a limiter/database failure does, never falling through to
    // reCAPTCHA or the subscriber lifecycle.
    return { kind: "RATE_LIMITED", retryAfterSeconds: deps.rateLimitConfig.windowSeconds }
  }

  const rateLimitOutcome = await checkRateLimit({
    store: deps.store,
    clientAddress: deps.clientAddress.address,
    config: deps.rateLimitConfig,
    now,
  })

  if (!rateLimitOutcome.allowed) {
    return { kind: "RATE_LIMITED", retryAfterSeconds: rateLimitOutcome.retryAfterSeconds }
  }

  if (typeof input.honeypot === "string" && input.honeypot.length > 0) {
    return { kind: "ACCEPTED" }
  }

  const recaptchaResult = await deps.recaptchaVerifier.verify(input.recaptchaToken)
  if (!recaptchaResult.verified) {
    return {
      kind: "RECAPTCHA_FAILED",
      providerUnavailable: recaptchaResult.reason === "PROVIDER_ERROR",
    }
  }

  const signupResult = await deps.store.prepareSubscription({
    firstName: input.firstName,
    email: input.email,
    consentTextVersion: NEWSLETTER_CONSENT_TEXT_VERSION,
    source: NEWSLETTER_SIGNUP_SOURCE,
  })

  if (signupResult.outcome === "PENDING_CREATED" || signupResult.outcome === "PENDING_REFRESHED") {
    await sendConfirmationEmailWithProtections({
      store: deps.store,
      sender: deps.emailSender,
      config: deps.emailConfig,
      subscriberId: signupResult.subscriberId,
      firstName: input.firstName,
      email: input.email,
      countryCode: input.countryCode,
      confirmationToken: signupResult.confirmationToken,
      now,
    })
  }

  return { kind: "ACCEPTED" }
}
