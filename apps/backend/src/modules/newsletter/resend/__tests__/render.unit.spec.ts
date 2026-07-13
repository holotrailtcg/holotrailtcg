import { renderConfirmationEmail, CONFIRMATION_EMAIL_SUBJECT } from "../render"

const confirmationUrl = "https://holotrailtcg.example/gb/newsletter/confirm?token=abc123"

describe("renderConfirmationEmail", () => {
  it("includes the confirmation link in the HTML body", () => {
    const { html } = renderConfirmationEmail({ firstName: "Ash", confirmationUrl })
    expect(html).toContain(confirmationUrl)
  })

  it("includes the confirmation link in the text body", () => {
    const { text } = renderConfirmationEmail({ firstName: "Ash", confirmationUrl })
    expect(text).toContain(confirmationUrl)
  })

  it("states that confirmation is required", () => {
    const { html, text } = renderConfirmationEmail({ firstName: "Ash", confirmationUrl })
    expect(html.toLowerCase()).toContain("confirm")
    expect(text.toLowerCase()).toContain("confirm")
  })

  it("does not claim the subscription is already complete", () => {
    const { html, text } = renderConfirmationEmail({ firstName: "Ash", confirmationUrl })
    expect(html.toLowerCase()).not.toContain("you are subscribed")
    expect(html.toLowerCase()).not.toContain("already subscribed")
    expect(text.toLowerCase()).not.toContain("you are subscribed")
    expect(text.toLowerCase()).not.toContain("already subscribed")
  })

  it("never mentions a discount code or the 10% offer", () => {
    const { html, text } = renderConfirmationEmail({ firstName: "Ash", confirmationUrl })
    expect(html.toLowerCase()).not.toContain("10%")
    expect(html.toLowerCase()).not.toContain("discount")
    expect(text.toLowerCase()).not.toContain("10%")
    expect(text.toLowerCase()).not.toContain("discount")
  })

  it("escapes an HTML-unsafe first name in the HTML body", () => {
    const { html } = renderConfirmationEmail({
      firstName: `<script>alert(1)</script>`,
      confirmationUrl,
    })
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("does not escape the first name in the plain-text body", () => {
    const { text } = renderConfirmationEmail({ firstName: "Ash & Co", confirmationUrl })
    expect(text).toContain("Ash & Co")
  })

  it("falls back to a generic greeting for an empty first name", () => {
    const { html, text } = renderConfirmationEmail({ firstName: "   ", confirmationUrl })
    expect(html).toContain("Hi there,")
    expect(text).toContain("Hi there,")
  })

  it("escapes an unsafe URL for the HTML attribute", () => {
    const unsafeUrl = `https://holotrailtcg.example/gb/newsletter/confirm?token="><script>alert(1)</script>`
    const { html } = renderConfirmationEmail({ firstName: "Ash", confirmationUrl: unsafeUrl })
    expect(html).not.toContain(`"><script>`)
  })

  it("produces plain text with no HTML tags", () => {
    const { text } = renderConfirmationEmail({ firstName: "Ash", confirmationUrl })
    expect(text).not.toMatch(/<[a-z][\s\S]*>/i)
  })

  it("does not include a token in the subject", () => {
    expect(CONFIRMATION_EMAIL_SUBJECT).not.toMatch(/token/i)
    expect(CONFIRMATION_EMAIL_SUBJECT).not.toContain("abc123")
  })

  it("does not include the recipient email in the subject", () => {
    expect(CONFIRMATION_EMAIL_SUBJECT).not.toMatch(/@/)
  })
})
