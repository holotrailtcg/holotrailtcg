import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { comingSoonContent } from "@content/coming-soon"

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

  it("uses separate approved photographs for the hero and building sections", () => {
    const html = renderToStaticMarkup(
      React.createElement(ComingSoonView, { countryCode: "gb" })
    )
    expect(html).toContain("thimo-pedersen-TWCnHKKhqSo-unsplash-hero.webp")
    expect(html).toContain("halfcut-pokemon-WrUGh2DXfiw-unsplash-building.webp")
    expect(html).toContain('alt=""')
  })

  it("renders the newsletter, building and FAQ as distinct full-width sections", () => {
    const html = renderToStaticMarkup(
      React.createElement(ComingSoonView, { countryCode: "gb" })
    )

    const joinList = html.indexOf('aria-labelledby="join-list-heading"')
    const building = html.indexOf(
      'aria-labelledby="what-were-building-heading"'
    )
    const faq = html.indexOf('aria-labelledby="coming-soon-faq-heading"')

    expect(joinList).toBeGreaterThan(-1)
    expect(building).toBeGreaterThan(joinList)
    expect(faq).toBeGreaterThan(building)
  })

  it("renders a navigation-free logo header without a coming-soon pill", () => {
    const html = renderToStaticMarkup(
      React.createElement(ComingSoonView, { countryCode: "gb" })
    )
    const header = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)

    expect(header).not.toBeNull()
    expect(header?.[1]).toContain("Holo Trail TCG")
    expect(header?.[1]).not.toContain("<nav")
    expect(header?.[1]).not.toContain("Coming soon")
  })

  it("renders one clear H1 and the approved UK-focused page content", () => {
    const html = renderToStaticMarkup(
      React.createElement(ComingSoonView, { countryCode: "gb" })
    )

    expect(html.match(/<h1\b/g)).toHaveLength(1)
    expect(html).toContain("A better way to buy Pokémon singles is on the way")
    expect(html).toContain("What we’re building")
    expect(html).toContain("Carefully checked singles")
    expect(html).toContain("Clear card condition")
    expect(html).toContain("Secure UK delivery")
    expect(html).toContain("A few things you might be wondering")
    expect(html).toContain("What will Holo Trail sell?")
    expect(html).toContain("Where will you deliver?")
  })

  it("preserves the newsletter form, explicit consent and privacy link", () => {
    const html = renderToStaticMarkup(
      React.createElement(ComingSoonView, { countryCode: "gb" })
    )

    expect(html).toContain("Join the list")
    expect(html).toContain("First name")
    expect(html).toContain("Email")
    expect(html).toContain(comingSoonContent.form.consentLabel)
    expect(html).toContain("Notify me")
    expect(html).toContain('href="/gb/privacy"')
  })

  it("does not announce a launch date or imply an official affiliation", () => {
    const content = JSON.stringify(comingSoonContent)

    expect(content).not.toMatch(
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b/i
    )
    expect(content).not.toMatch(/official (?:Pokémon|Nintendo) (?:shop|store)/i)
    expect(content).toContain(
      "Holo Trail TCG is an independent retailer and is not affiliated with or endorsed by Nintendo"
    )
    expect(content).toContain(comingSoonContent.trademarkDisclaimer)
  })
})
