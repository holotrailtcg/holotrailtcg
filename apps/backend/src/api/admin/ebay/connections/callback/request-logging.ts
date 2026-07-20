import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * Morgan reads `originalUrl` when the response finishes. The eBay OAuth
 * callback carries one-time credentials in its query string, so remove only
 * that logging field before the request reaches the route. `url`, `query`,
 * and params deliberately remain intact for callback validation.
 */
export function redactEbayCallbackQueryFromRequestLog(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
): void {
  try {
    req.originalUrl = new URL(req.originalUrl, "http://localhost").pathname
  } catch {
    // Never retain a malformed URL's query in the access-log-visible field.
    req.originalUrl = "/admin/ebay/connections/callback"
  }
  next()
}
