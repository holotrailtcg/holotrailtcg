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
})
