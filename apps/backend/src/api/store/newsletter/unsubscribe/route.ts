import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resolveNewsletterModuleService } from "../shared/dependencies"
import { setTokenRouteProtectionHeaders, type UnsubscribeResultCode } from "../shared/response"
import { handleNewsletterRouteError } from "../shared/error-mapping"
import { tokenQuerySchema } from "../shared/validation"

/**
 * `GET /store/newsletter/unsubscribe?token=...`. Mirrors `confirm/route.ts`
 * — thin, validates the opaque token shape, delegates to the existing
 * unsubscribe lifecycle (`NewsletterModuleService.unsubscribeSubscription`,
 * idempotent by construction, never sends email), and maps the result to
 * one of three stable, minimal public codes.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  setTokenRouteProtectionHeaders(res)

  try {
    const parsed = tokenQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ result: "invalid" satisfies UnsubscribeResultCode })
      return
    }

    const store = resolveNewsletterModuleService(req.scope)
    const outcome = await store.unsubscribeSubscription(parsed.data.token)

    const result: UnsubscribeResultCode =
      outcome.outcome === "UNSUBSCRIBED"
        ? "unsubscribed"
        : outcome.outcome === "ALREADY_UNSUBSCRIBED"
          ? "already_unsubscribed"
          : "invalid"

    res.status(200).json({ result })
  } catch {
    handleNewsletterRouteError("unsubscribe", res)
  }
}
