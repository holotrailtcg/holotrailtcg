import type { MedusaResponse } from "@medusajs/framework/http"

/**
 * The one generic body every accepted `POST /store/newsletter/subscribe`
 * submission returns, regardless of new/pending/confirmed/unsubscribed
 * outcome, honeypot trigger, or any other branch that must not disclose
 * subscriber state. Never include subscriber id, status, email, first
 * name, token, provider id, send state or discount eligibility here.
 */
export const SUBSCRIBE_ACCEPTED_RESPONSE_BODY = {
  success: true,
  message: "If the details are valid, check your inbox for a confirmation email.",
} as const

export type ConfirmResultCode = "confirmed" | "already_confirmed" | "invalid_or_expired"
export type UnsubscribeResultCode = "unsubscribed" | "already_unsubscribed" | "invalid"

/**
 * `Cache-Control`/`Pragma`/`Referrer-Policy` protections for the
 * token-bearing GET routes (`confirm`, `unsubscribe`). These routes are
 * reached via a one-time link in an email; the token must never be cached
 * by an intermediary or leaked via the `Referer` header of a subsequent
 * navigation away from the result.
 */
export function setTokenRouteProtectionHeaders(res: MedusaResponse): void {
  res.setHeader("Cache-Control", "no-store")
  res.setHeader("Pragma", "no-cache")
  res.setHeader("Referrer-Policy", "no-referrer")
}
