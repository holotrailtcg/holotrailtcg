/**
 * Confirmation-email content — the only email type Stage 2C.5 implements
 * (docs/decisions/0005-newsletter-backend-design.md). HTML and plain text
 * are generated from this single function so the wording rules ("has not
 * completed subscription until confirmed", no fake urgency, no "already
 * subscribed", no discount code) are enforced in one place rather than two
 * hand-maintained copies.
 *
 * Deliberately takes only `firstName` and `confirmationUrl` — no email
 * address, subscriber id, or token hash is ever available to this
 * function, so none of it can leak into the rendered content.
 */

export const CONFIRMATION_EMAIL_SUBJECT = "Confirm your Holo Trail TCG updates"

export interface RenderConfirmationEmailInput {
  firstName: string
  confirmationUrl: string
}

export interface RenderedConfirmationEmail {
  subject: string
  html: string
  text: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function greetingName(firstName: string): string {
  const trimmed = typeof firstName === "string" ? firstName.trim() : ""
  return trimmed.length > 0 ? trimmed : "there"
}

export function renderConfirmationEmail(
  input: RenderConfirmationEmailInput
): RenderedConfirmationEmail {
  const name = greetingName(input.firstName)
  const url = input.confirmationUrl

  const safeName = escapeHtml(name)
  // The URL is placed inside a double-quoted HTML attribute; the same
  // escaping used for text content is sufficient there too.
  const safeUrl = escapeHtml(url)

  const html = `<!doctype html>
<html lang="en-GB">
  <body style="font-family: sans-serif; color: #1a1a2e; background-color: #faf6ee; padding: 24px;">
    <p>Hi ${safeName},</p>
    <p>Someone requested to sign up for Holo Trail TCG newsletter updates using this email address.</p>
    <p>You are not yet subscribed. Please confirm this request to complete your sign-up:</p>
    <p><a href="${safeUrl}">Confirm your subscription</a></p>
    <p>If you did not request this, you can ignore this email and no further action is needed.</p>
    <p>Thanks,<br />Holo Trail TCG</p>
  </body>
</html>
`

  const text = `Hi ${name},

Someone requested to sign up for Holo Trail TCG newsletter updates using this email address.

You are not yet subscribed. Please confirm this request to complete your sign-up:
${url}

If you did not request this, you can ignore this email and no further action is needed.

Thanks,
Holo Trail TCG
`

  return { subject: CONFIRMATION_EMAIL_SUBJECT, html, text }
}
