import { Resend } from "resend"
import type { ResendConfig } from "./config"
import type { RenderedConfirmationEmail } from "./render"

export interface SendConfirmationEmailInput {
  toEmail: string
  rendered: RenderedConfirmationEmail
  idempotencyKey: string
}

export type ConfirmationEmailSendOutcome =
  | { status: "SENT"; providerMessageId: string }
  | { status: "FAILED" }
  | { status: "AMBIGUOUS" }

/**
 * The confirmation-email delivery boundary a future public route (or the
 * delivery orchestrator in `./delivery.ts`) depends on. Production code
 * depends on this interface, not on `ResendConfirmationEmailSender`
 * directly — the lifecycle/module service never imports the `resend`
 * package, and automated tests inject a fake implementation instead of
 * making a real network call.
 */
export interface ConfirmationEmailSender {
  send(input: SendConfirmationEmailInput): Promise<ConfirmationEmailSendOutcome>
}

/**
 * Bounded timeout for the outbound Resend call. The official Node SDK
 * documents no client-level timeout or abort-signal option (confirmed
 * against the SDK source and API reference — see
 * docs/decisions/0005-newsletter-backend-design.md), so this is enforced
 * externally with `Promise.race`. This does not cancel the underlying HTTP
 * request; it only stops *waiting* for it, which is exactly why a timeout
 * here is classified as ambiguous, not a definitive failure — the request
 * itself may still be accepted by Resend after this function returns.
 */
const SEND_TIMEOUT_MS = 10_000

/**
 * Resend error names documented (https://resend.com/docs/api-reference/errors)
 * as a definitive rejection of this specific request — the provider
 * examined the request (or its own quota/rate limit) and refused it before
 * any email was queued, so no email was sent and a later retry is safe.
 * Any error name not in this set (including `application_error`,
 * `internal_server_error`, or any future/unrecognised name) is treated as
 * ambiguous rather than assumed to be a clean failure.
 */
const DEFINITIVE_FAILURE_ERROR_NAMES = new Set([
  "missing_api_key",
  "invalid_api_key",
  "restricted_api_key",
  "invalid_from_address",
  "invalid_to_address",
  "invalid_idempotency_key",
  "invalid_attachment",
  "missing_required_field",
  "validation_error",
  "rate_limit_exceeded",
  "monthly_quota_exceeded",
  "daily_quota_exceeded",
])

/**
 * Production confirmation-email sender, implemented against the official
 * `resend` Node SDK (see docs/decisions/0005-newsletter-backend-design.md
 * for the exact version and the official-documentation review this is
 * based on). This is the only file in the newsletter module allowed to
 * import `resend`.
 *
 * Never logs the API key, the recipient address, the rendered content, the
 * idempotency key, or the raw provider response — on every path this
 * class returns only the minimal `ConfirmationEmailSendOutcome` above.
 */
export class ResendConfirmationEmailSender implements ConfirmationEmailSender {
  private readonly client: Resend
  private readonly fromEmail: string
  private readonly replyToEmail: string

  constructor(config: Pick<ResendConfig, "apiKey" | "fromEmail" | "replyToEmail">) {
    this.client = new Resend(config.apiKey)
    this.fromEmail = config.fromEmail
    this.replyToEmail = config.replyToEmail
  }

  async send(input: SendConfirmationEmailInput): Promise<ConfirmationEmailSendOutcome> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<"TIMEOUT">((resolve) => {
      timer = setTimeout(() => resolve("TIMEOUT"), SEND_TIMEOUT_MS)
      timer.unref?.()
    })

    const sendPromise = this.client.emails.send(
      {
        from: this.fromEmail,
        to: [input.toEmail],
        replyTo: this.replyToEmail,
        subject: input.rendered.subject,
        html: input.rendered.html,
        text: input.rendered.text,
      },
      { idempotencyKey: input.idempotencyKey }
    )

    let raced: Awaited<typeof sendPromise> | "TIMEOUT"
    try {
      raced = await Promise.race([sendPromise, timeoutPromise])
    } catch {
      // The SDK call itself threw (e.g. a network failure). Whether
      // Resend received and accepted the request before the connection
      // dropped is unknown, so this is ambiguous, not a definitive
      // failure.
      clearTimeout(timer)
      return { status: "AMBIGUOUS" }
    }
    clearTimeout(timer)

    if (raced === "TIMEOUT") {
      return { status: "AMBIGUOUS" }
    }

    const { data, error } = raced

    if (error) {
      if (DEFINITIVE_FAILURE_ERROR_NAMES.has(error.name)) {
        return { status: "FAILED" }
      }
      return { status: "AMBIGUOUS" }
    }

    if (!data?.id) {
      // A successful-looking response without the documented `id` field is
      // malformed; acceptance cannot be confirmed from it.
      return { status: "AMBIGUOUS" }
    }

    return { status: "SENT", providerMessageId: data.id }
  }
}
