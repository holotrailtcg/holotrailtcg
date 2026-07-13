import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resolveNewsletterModuleService } from "../shared/dependencies"
import { setTokenRouteProtectionHeaders, type ConfirmResultCode } from "../shared/response"
import { handleNewsletterRouteError } from "../shared/error-mapping"
import { tokenQuerySchema } from "../shared/validation"

/**
 * `GET /store/newsletter/confirm?token=...`. Thin by design — validates the
 * opaque token shape, delegates to the existing confirmation lifecycle
 * (`NewsletterModuleService.confirmSubscription`, which hashes the token
 * before every lookup and is idempotent by construction), and maps the
 * result to one of three stable, minimal public codes. Never returns
 * subscriber data, the token, or a token hash. See
 * docs/decisions/0005-newsletter-backend-design.md, Stage 2C.6 notes.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  setTokenRouteProtectionHeaders(res)

  try {
    const parsed = tokenQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ result: "invalid_or_expired" satisfies ConfirmResultCode })
      return
    }

    const store = resolveNewsletterModuleService(req.scope)
    const outcome = await store.confirmSubscription(parsed.data.token)

    const result: ConfirmResultCode =
      outcome.outcome === "CONFIRMED"
        ? "confirmed"
        : outcome.outcome === "ALREADY_CONFIRMED"
          ? "already_confirmed"
          : "invalid_or_expired"

    res.status(200).json({ result })
  } catch {
    handleNewsletterRouteError("confirm", res)
  }
}
