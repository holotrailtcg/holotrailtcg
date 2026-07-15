import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { PrivacyView } from "./privacy-view"

/**
 * Renders the real page composition (not a reimplementation) to static HTML
 * and asserts the actual generated navigation target, not just that the
 * `/coming-soon` route responds when hit directly.
 */
describe("PrivacyView locale-aware links", () => {
  it("generates /gb/coming-soon links when rendered for countryCode=gb", () => {
    const html = renderToStaticMarkup(
      React.createElement(PrivacyView, { countryCode: "gb" })
    )
    const matches = html.match(/href="\/gb\/coming-soon"/g) ?? []
    // The header logo and the "Back to Holo Trail TCG" link both point home.
    expect(matches.length).toBe(2)
  })

  it("generates a locale-aware link for a different country code", () => {
    const html = renderToStaticMarkup(
      React.createElement(PrivacyView, { countryCode: "dk" })
    )
    expect(html).toContain('href="/dk/coming-soon"')
    expect(html).not.toContain('href="/gb/coming-soon"')
  })

  it("renders the implemented mailing-list facts and no placeholder wording", () => {
    const html = renderToStaticMarkup(
      React.createElement(PrivacyView, { countryCode: "gb" })
    )

    expect(html).toContain("Privacy notice")
    expect(html).toContain("Last updated: 15 July 2026")
    expect(html).toContain("What we collect")
    expect(html).toContain("Why we use it and our lawful bases")
    expect(html).toContain("Marketing and withdrawing consent")
    expect(html).toContain("Cookies and local storage")
    expect(html).toContain("Transfers outside the UK")
    expect(html).toContain("Google reCAPTCHA")
    expect(html).toContain("Resend")
    expect(html).toContain("Your data protection rights")
    expect(html).toContain("Complain to the ICO")
    expect(html).not.toMatch(/placeholder|being prepared/i)
  })

  it("provides direct privacy, provider and regulator contact routes", () => {
    const html = renderToStaticMarkup(
      React.createElement(PrivacyView, { countryCode: "gb" })
    )

    expect(html).toContain("https://www.facebook.com/holotrailtcg/about/")
    expect(html).toContain("https://www.instagram.com/holotrailtcg/")
    expect(html).not.toContain("mailto:")
    expect(html).toContain("https://policies.google.com/privacy")
    expect(html).toContain("https://resend.com/legal/privacy-policy")
    expect(html).toContain("https://ico.org.uk/make-a-complaint/")
  })
})
