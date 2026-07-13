import { model } from "@medusajs/framework/utils"

/**
 * Subscriber lifecycle status. Exactly these three values, per the Stage 2C
 * design (docs/decisions/0005-newsletter-backend-design.md). Do not add
 * delivery-outcome or marketing-segment statuses here — those are tracked
 * separately (see `confirmation_send_state` below).
 */
export const SUBSCRIBER_STATUS = {
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  UNSUBSCRIBED: "UNSUBSCRIBED",
} as const

export type SubscriberStatus =
  (typeof SUBSCRIBER_STATUS)[keyof typeof SUBSCRIBER_STATUS]

/**
 * Confirmation-email delivery bookkeeping. This is deliberately separate
 * from `SUBSCRIBER_STATUS`: a subscriber can be `PENDING` while its most
 * recent confirmation email is `SENT`, `FAILED`, `SENDING`, `UNKNOWN`, or
 * has never been attempted (`NOT_SENT`). Do not treat this as consent or
 * confirmation state — those live in `consented_at`/`consent_text_version`
 * and `status`/`confirmed_at` respectively.
 *
 * `SENDING` and `UNKNOWN` were added in Stage 2C.5
 * (docs/decisions/0005-newsletter-backend-design.md) to support a
 * concurrency-safe delivery reservation and to distinguish a definitive
 * provider failure (`FAILED`) from an ambiguous outcome — timeout, network
 * disconnect after transmission, malformed response — where the provider
 * may have already accepted the email (`UNKNOWN`). An ambiguous outcome
 * must never be treated as a confirmed failure, and must never advance the
 * subscriber to `CONFIRMED`.
 */
export const CONFIRMATION_SEND_STATE = {
  NOT_SENT: "NOT_SENT",
  SENDING: "SENDING",
  SENT: "SENT",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN",
} as const

export type ConfirmationSendState =
  (typeof CONFIRMATION_SEND_STATE)[keyof typeof CONFIRMATION_SEND_STATE]

/**
 * A newsletter subscriber. This is the source of truth for the newsletter
 * mailing list; it is intentionally separate from Medusa customer records
 * (see docs/decisions/0005-newsletter-backend-design.md) — newsletter
 * signup must never create a Medusa customer.
 *
 * `normalised_email` (not `email`) is the canonical uniqueness boundary.
 * The normalisation algorithm itself is out of scope for Stage 2C.2; this
 * model only establishes the storage contract and its database-level
 * uniqueness guarantee.
 *
 * `confirmation_email_last_sent_at` and `confirmation_send_state` exist
 * only to support a future resend cooldown and stuck-send detection
 * (Stage 2C.3+). They are not part of the subscriber's consent or
 * confirmation state.
 *
 * `confirmation_token_consumed_hash` (Stage 2C.3) records the hash of the
 * confirmation token that was actually used to confirm, kept *after*
 * `confirmation_token_hash` is cleared on success. Without it, a repeated
 * click on an already-used confirmation link would be indistinguishable
 * from an arbitrary invalid token, since the active hash no longer exists
 * anywhere to compare against. This lets confirmation stay idempotent
 * without retaining an active, still-usable confirmation token
 * indefinitely. See docs/decisions/0005-newsletter-backend-design.md.
 *
 * `confirmation_send_reserved_at` (Stage 2C.5) records when a confirmation
 * email send was last reserved (moved to `SENDING`). It exists so a
 * reservation that never reached a terminal state — the process crashed or
 * was killed mid-send — can be recognised as stale after a bounded interval
 * and safely retried, without a second concurrent request being able to
 * send the same logical email while a recent reservation is still active.
 */
const Subscriber = model
  .define(
    { name: "Subscriber", tableName: "newsletter_subscriber" },
    {
      id: model.id({ prefix: "nlsub" }).primaryKey(),
      first_name: model.text(),
      email: model.text(),
      normalised_email: model
        .text()
        .unique("IDX_newsletter_subscriber_normalised_email"),
      status: model
        .enum(Object.values(SUBSCRIBER_STATUS))
        .default(SUBSCRIBER_STATUS.PENDING)
        .index("IDX_newsletter_subscriber_status"),
      consent_text_version: model.text(),
      consented_at: model.dateTime(),
      source: model.text(),
      confirmation_token_hash: model
        .text()
        .unique("IDX_newsletter_subscriber_confirmation_token_hash")
        .nullable(),
      confirmation_token_expires_at: model.dateTime().nullable(),
      confirmed_at: model.dateTime().nullable(),
      unsubscribe_token_hash: model
        .text()
        .unique("IDX_newsletter_subscriber_unsubscribe_token_hash")
        .nullable(),
      unsubscribed_at: model.dateTime().nullable(),
      confirmation_token_consumed_hash: model
        .text()
        .unique("IDX_newsletter_subscriber_confirmation_token_consumed_hash")
        .nullable(),
      first_purchase_discount_eligible: model.boolean().default(false),
      confirmation_email_last_sent_at: model.dateTime().nullable(),
      confirmation_send_state: model
        .enum(Object.values(CONFIRMATION_SEND_STATE))
        .default(CONFIRMATION_SEND_STATE.NOT_SENT),
      confirmation_send_reserved_at: model.dateTime().nullable(),
    }
  )
  .checks([
    {
      name: "CK_newsletter_subscriber_first_name_length",
      expression: (columns) => `length(${columns.first_name}) <= 100`,
    },
    {
      name: "CK_newsletter_subscriber_email_length",
      expression: (columns) => `length(${columns.email}) <= 254`,
    },
    {
      name: "CK_newsletter_subscriber_normalised_email_length",
      expression: (columns) => `length(${columns.normalised_email}) <= 254`,
    },
    {
      name: "CK_newsletter_subscriber_consent_text_version_length",
      expression: (columns) => `length(${columns.consent_text_version}) <= 32`,
    },
    {
      name: "CK_newsletter_subscriber_source_length",
      expression: (columns) => `length(${columns.source}) <= 64`,
    },
  ])

export default Subscriber
