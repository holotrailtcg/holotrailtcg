import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ComingSoonView } from "./coming-soon-view"

/**
 * Renders the real page composition (not a reimplementation) to static HTML
 * and asserts the actual generated navigation target, not just that the
 * `/privacy` route responds when hit directly.
 */
describe("ComingSoonView locale-aware links", () => {
  it("generates a /gb/privacy link when rendered for countryCode=gb", () => {
    const html = renderToStaticMarkup(
      React.createElement(ComingSoonView, { countryCode: "gb" })
    )
    expect(html).toContain('href="/gb/privacy"')
  })

  it("generates a locale-aware link for a different country code", () => {
    const html = renderToStaticMarkup(
      React.createElement(ComingSoonView, { countryCode: "dk" })
    )
    expect(html).toContain('href="/dk/privacy"')
    expect(html).not.toContain('href="/gb/privacy"')
  })
})
