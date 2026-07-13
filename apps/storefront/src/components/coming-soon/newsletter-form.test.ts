import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { comingSoonContent } from "@content/coming-soon"
import { NewsletterForm } from "./newsletter-form"

describe("NewsletterForm presentation", () => {
  it("renders an empty, bounded, off-screen honeypot outside the tab order", () => {
    const html = renderToStaticMarkup(
      React.createElement(NewsletterForm, {
        countryCode: "gb",
        recaptchaSiteKey: "public-test-key",
      }),
    )
    expect(html).toContain('name="honeypot"')
    expect(html).toContain('value=""')
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('maxLength="200"')
    expect(html).toContain("Leave this field empty")
    expect(html).not.toContain("display:none")
  })

  it("keeps safe generic messages with no state, delivery promise, or discount code", () => {
    const form = comingSoonContent.form
    expect(form.successBody).toBe(
      "If the details are valid, check your inbox for a confirmation email.",
    )
    expect(form.successSupporting).toContain("until you confirm")
    expect(JSON.stringify(form)).not.toMatch(
      /subscriber status|email was sent|discount code/i,
    )
    expect(form.errors.rate_limited).toContain("Too many attempts")
    expect(form.errors.verification_failure).not.toMatch(
      /score|action|hostname/i,
    )
    expect(form.errors.temporarily_unavailable).not.toMatch(
      /resend|medusa|stack/i,
    )
  })
})
