import type { ConfirmationEmailReservationOutcome } from "../lifecycle/types"
import { hashToken } from "../lifecycle/token"
import type { ResendConfig } from "./config"
import { buildConfirmationUrl } from "./confirmation-url"
import { renderConfirmationEmail } from "./render"
import { deriveConfirmationEmailIdempotencyKey } from "./idempotency-key"
import type { ConfirmationEmailSender } from "./sender"

/**
 * The minimal persistence contract this orchestrator needs — satisfied by
 * `NewsletterModuleService` in production, and by a plain fake in unit
 * tests. Mirrors the same "narrow injected store interface" pattern
 * `rate-limit/rate-limiter.ts`'s `RateLimitBucketStore` already
 * established, so the reservation/finalisation decision stays testable
 * without a database.
 */
export interface ConfirmationEmailDeliveryStore {
  reserveConfirmationEmailSend(input: {
    subscriberId: string
    confirmationTokenHash: string
    now: Date
    cooldownCutoff: Date
    staleReservationCutoff: Date
  }): Promise<ConfirmationEmailReservationOutcome>
  markConfirmationEmailSent(
    subscriberId: string,
    confirmationTokenHash: string,
    sentAt: Date
  ): Promise<void>
  markConfirmationEmailFailed(subscriberId: string, confirmationTokenHash: string): Promise<void>
  markConfirmationEmailAmbiguous(subscriberId: string, confirmationTokenHash: string): Promise<void>
}

export interface SendConfirmationEmailWithProtectionsInput {
  store: ConfirmationEmailDeliveryStore
  sender: ConfirmationEmailSender
  config: Pick<
    ResendConfig,
    "storefrontBaseUrl" | "confirmationEmailCooldownSeconds" | "confirmationEmailStaleReservationSeconds"
  >
  subscriberId: string
  firstName: string
  email: string
  countryCode: string
  /** The plaintext confirmation token from the subscriber lifecycle result. */
  confirmationToken: string
  /** Injected only for deterministic tests; production always uses `new Date()`. */
  now?: Date
}

export type ConfirmationEmailDeliveryOutcome =
  | { status: "SENT" }
  | { status: "SUPPRESSED_COOLDOWN" }
  | { status: "ALREADY_IN_FLIGHT" }
  | { status: "STALE_TOKEN" }
  | { status: "NOT_PENDING" }
  | { status: "FAILED" }
  | { status: "AMBIGUOUS" }

/**
 * Reserves, renders and sends the confirmation email for one logical
 * attempt, applying every protection Stage 2C.5 requires
 * (docs/decisions/0005-newsletter-backend-design.md):
 *
 * 1. Reserve the attempt (atomic conditional `UPDATE`, bound to the
 *    current confirmation-token hash, gated by the resend cooldown and
 *    stale-reservation recovery). No transaction is held open past this
 *    single statement.
 * 2. Only if reserved: build the confirmation URL, render the email, and
 *    derive the deterministic Resend idempotency key — all from the
 *    plaintext token and the hash `reserveConfirmationEmailSend` already
 *    validated, never re-fetched or re-hashed differently.
 * 3. Call the injected `sender` (a real network call in production, a fake
 *    in tests) with no open database transaction.
 * 4. Finalise the reservation based on the provider outcome: `SENT` (never
 *    touches subscriber status/eligibility), `FAILED` (definitive,
 *    safely retryable later), or `UNKNOWN` (ambiguous — never treated as a
 *    confirmed failure and never advances the subscriber to `CONFIRMED`).
 *
 * Not exported for direct route use in this stage — Stage 2C.5 has no
 * public route calling this yet; it exists so a later stage can wire it up
 * without redesigning the delivery boundary.
 */
export async function sendConfirmationEmailWithProtections(
  input: SendConfirmationEmailWithProtectionsInput
): Promise<ConfirmationEmailDeliveryOutcome> {
  const now = input.now ?? new Date()
  const confirmationTokenHash = hashToken(input.confirmationToken)

  const cooldownCutoff = new Date(
    now.getTime() - input.config.confirmationEmailCooldownSeconds * 1000
  )
  const staleReservationCutoff = new Date(
    now.getTime() - input.config.confirmationEmailStaleReservationSeconds * 1000
  )

  const reservation = await input.store.reserveConfirmationEmailSend({
    subscriberId: input.subscriberId,
    confirmationTokenHash,
    now,
    cooldownCutoff,
    staleReservationCutoff,
  })

  if (!reservation.reserved) {
    return { status: reservation.reason }
  }

  const confirmationUrl = buildConfirmationUrl({
    storefrontBaseUrl: input.config.storefrontBaseUrl,
    countryCode: input.countryCode,
    confirmationToken: input.confirmationToken,
  })
  const rendered = renderConfirmationEmail({
    firstName: input.firstName,
    confirmationUrl,
  })
  const idempotencyKey = deriveConfirmationEmailIdempotencyKey(
    input.subscriberId,
    confirmationTokenHash
  )

  const outcome = await input.sender.send({
    toEmail: input.email,
    rendered,
    idempotencyKey,
  })

  if (outcome.status === "SENT") {
    await input.store.markConfirmationEmailSent(input.subscriberId, confirmationTokenHash, new Date())
    return { status: "SENT" }
  }

  if (outcome.status === "FAILED") {
    await input.store.markConfirmationEmailFailed(input.subscriberId, confirmationTokenHash)
    return { status: "FAILED" }
  }

  await input.store.markConfirmationEmailAmbiguous(input.subscriberId, confirmationTokenHash)
  return { status: "AMBIGUOUS" }
}
