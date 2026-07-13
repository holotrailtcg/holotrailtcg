import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resolveRateLimitConfig } from "../../../../modules/newsletter/rate-limit/config"
import { resolveResendConfig } from "../../../../modules/newsletter/resend/config"
import {
  resolveNewsletterModuleService,
  resolveRecaptchaVerifier,
  resolveConfirmationEmailSender,
} from "../shared/dependencies"
import { resolveRequestClientAddress } from "../shared/client-address"
import { orchestrateNewsletterSubscription } from "../shared/subscribe-orchestrator"
import { SUBSCRIBE_ACCEPTED_RESPONSE_BODY } from "../shared/response"
import { handleNewsletterRouteError } from "../shared/error-mapping"
import type { SubscribeBody } from "../shared/validation"

/**
 * `POST /store/newsletter/subscribe`. Thin by design — parses/validates
 * input via `validateAndTransformBody` (registered in
 * `src/api/middlewares.ts`), resolves dependencies from the request scope,
 * and delegates the entire processing order to
 * `orchestrateNewsletterSubscription` (see
 * docs/decisions/0005-newsletter-backend-design.md, Stage 2C.6 notes, for
 * the exact order and every public-response rule this route follows).
 */
export async function POST(
  req: MedusaRequest<SubscribeBody>,
  res: MedusaResponse
): Promise<void> {
  try {
    const body = req.validatedBody

    const store = resolveNewsletterModuleService(req.scope)
    const recaptchaVerifier = resolveRecaptchaVerifier(req.scope)
    const emailSender = resolveConfirmationEmailSender(req.scope)
    const rateLimitConfig = resolveRateLimitConfig()
    const emailConfig = resolveResendConfig()
    const clientAddress = resolveRequestClientAddress(req)

    const result = await orchestrateNewsletterSubscription(
      {
        firstName: body.firstName,
        email: body.email,
        honeypot: body.honeypot,
        recaptchaToken: body.recaptchaToken,
        countryCode: body.countryCode,
      },
      {
        store,
        recaptchaVerifier,
        emailSender,
        rateLimitConfig,
        emailConfig,
        clientAddress,
      }
    )

    if (result.kind === "RATE_LIMITED") {
      if (result.retryAfterSeconds > 0) {
        res.setHeader("Retry-After", String(result.retryAfterSeconds))
      }
      res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later.",
      })
      return
    }

    if (result.kind === "RECAPTCHA_FAILED") {
      res.status(result.providerUnavailable ? 503 : 403).json({
        success: false,
        message: result.providerUnavailable
          ? "The newsletter service is temporarily unavailable. Please try again shortly."
          : "We could not verify your submission. Please try again.",
      })
      return
    }

    res.status(202).json(SUBSCRIBE_ACCEPTED_RESPONSE_BODY)
  } catch {
    handleNewsletterRouteError("subscribe", res)
  }
}
