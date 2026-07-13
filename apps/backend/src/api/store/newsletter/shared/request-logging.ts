import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * Medusa 2.17's built-in Morgan logger writes `req.originalUrl` after the
 * response, including its query string. Remove the query only from that
 * logging field for token-bearing newsletter routes. `req.url` and `req.query`
 * remain unchanged, so routing and lifecycle processing still receive the
 * opaque token.
 */
export function redactNewsletterTokenQueryFromRequestLog(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
): void {
  req.originalUrl = req.originalUrl.split("?", 1)[0]
  next()
}
