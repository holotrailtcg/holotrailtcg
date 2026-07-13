import type { MedusaResponse } from "@medusajs/framework/http"

const GENERIC_SERVER_ERROR_BODY = {
  success: false,
  message: "The newsletter service is temporarily unavailable. Please try again shortly.",
} as const

/**
 * Maps any unexpected error escaping a newsletter route handler (a
 * configuration failure, a database error, an unhandled adapter exception)
 * to one generic `503` response. Never forwards `error.message`, a stack
 * trace, a database constraint name, or any provider detail to the client
 * — only a fixed, safe log line identifying the endpoint and broad
 * category is written, following the same `console`-based logging
 * convention already used by `src/jobs/newsletter-rate-limit-cleanup.ts`.
 */
export function handleNewsletterRouteError(endpoint: string, res: MedusaResponse): void {
  console.error(`[newsletter:${endpoint}] unhandled error while processing request`)
  res.status(503).json(GENERIC_SERVER_ERROR_BODY)
}
