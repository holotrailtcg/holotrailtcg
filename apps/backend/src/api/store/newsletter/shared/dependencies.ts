import type { MedusaContainer } from "@medusajs/framework/types"
import { asValue } from "@medusajs/framework/awilix"
import { NEWSLETTER_MODULE } from "../../../../modules/newsletter"
import type NewsletterModuleService from "../../../../modules/newsletter/service"
import {
  GoogleRecaptchaVerifier,
  type RecaptchaVerifier,
} from "../../../../modules/newsletter/recaptcha/verify"
import { resolveRecaptchaConfig } from "../../../../modules/newsletter/recaptcha/config"
import {
  ResendConfirmationEmailSender,
  type ConfirmationEmailSender,
} from "../../../../modules/newsletter/resend/sender"
import { resolveResendConfig } from "../../../../modules/newsletter/resend/config"

/**
 * Container registration keys for the two supporting adapters that have no
 * Medusa module of their own. These are resolved through the request
 * scope/container (never constructed inline in a route handler), per
 * docs/decisions/0005-newsletter-backend-design.md's "Dependency
 * resolution" requirement. Exported so HTTP integration tests can register
 * a fake under the same key before any request is made — see
 * `integration-tests/http/support/bootstrap.ts`.
 */
export const NEWSLETTER_RECAPTCHA_VERIFIER_KEY = "newsletterRecaptchaVerifier"
export const NEWSLETTER_CONFIRMATION_EMAIL_SENDER_KEY = "newsletterConfirmationEmailSender"

export function resolveNewsletterModuleService(
  container: MedusaContainer
): NewsletterModuleService {
  return container.resolve<NewsletterModuleService>(NEWSLETTER_MODULE)
}

/**
 * Lazily registers and resolves the production reCAPTCHA verifier.
 *
 * This is the smallest supported registration mechanism for an adapter
 * that has no dedicated Medusa module: nothing registers this key at
 * application boot, so the first real request constructs the real
 * `GoogleRecaptchaVerifier` (which resolves `RECAPTCHA_SECRET_KEY` and
 * friends, throwing if misconfigured) and caches it on the container for
 * every later request. Automated tests instead call
 * `container.register(...)` with a fake verifier immediately after the app
 * boots, before any request is made — `hasRegistration` is already `true`
 * by the time a route resolves this, so the real verifier (and its
 * `resolveRecaptchaConfig()` call) is never constructed during a test that
 * supplies a fake. There is no `NODE_ENV`-gated branch here; the only way
 * to get a different implementation is to register one before this
 * function is first called.
 */
export function resolveRecaptchaVerifier(container: MedusaContainer): RecaptchaVerifier {
  if (!container.hasRegistration(NEWSLETTER_RECAPTCHA_VERIFIER_KEY)) {
    container.register(
      NEWSLETTER_RECAPTCHA_VERIFIER_KEY,
      asValue(new GoogleRecaptchaVerifier(resolveRecaptchaConfig()))
    )
  }
  return container.resolve<RecaptchaVerifier>(NEWSLETTER_RECAPTCHA_VERIFIER_KEY)
}

/** Same lazy registration pattern as `resolveRecaptchaVerifier`, for the Resend confirmation-email sender. */
export function resolveConfirmationEmailSender(
  container: MedusaContainer
): ConfirmationEmailSender {
  if (!container.hasRegistration(NEWSLETTER_CONFIRMATION_EMAIL_SENDER_KEY)) {
    container.register(
      NEWSLETTER_CONFIRMATION_EMAIL_SENDER_KEY,
      asValue(new ResendConfirmationEmailSender(resolveResendConfig()))
    )
  }
  return container.resolve<ConfirmationEmailSender>(NEWSLETTER_CONFIRMATION_EMAIL_SENDER_KEY)
}
