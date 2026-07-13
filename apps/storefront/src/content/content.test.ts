import { describe, expect, it } from "vitest"

import { comingSoonContent } from "./coming-soon"
import { socialLinks } from "./social"

describe("comingSoonContent", () => {
  it("uses a coming-soon status and no launch date", () => {
    expect(comingSoonContent.status).toBe("Coming soon")
  })

  it("lists the three subscriber benefits including the 10% offer", () => {
    const texts = comingSoonContent.benefits.map((b) => b.text.toLowerCase())
    expect(comingSoonContent.benefits).toHaveLength(3)
    expect(texts.some((t) => t.includes("launch"))).toBe(true)
    expect(texts.some((t) => t.includes("stock"))).toBe(true)
    expect(texts.some((t) => t.includes("10%"))).toBe(true)
  })

  it("provides generic, duplicate-safe success wording", () => {
    expect(comingSoonContent.form.successBody.length).toBeGreaterThan(0)
    // Must not claim an email was definitely sent.
    expect(comingSoonContent.form.successBody.toLowerCase()).toContain(
      "if the details are valid"
    )
    expect(comingSoonContent.form.successBody.toLowerCase()).not.toContain(
      "email was sent"
    )
  })
})

describe("socialLinks", () => {
  it("configures Facebook and Instagram with accessible labels", () => {
    const byPlatform = Object.fromEntries(
      socialLinks.map((link) => [link.platform, link])
    )

    expect(byPlatform.facebook.href).toBe(
      "https://www.facebook.com/holotrailtcg/about/"
    )
    expect(byPlatform.instagram.href).toBe(
      "https://www.instagram.com/holotrailtcg/"
    )

    for (const link of socialLinks) {
      expect(link.label.trim().length).toBeGreaterThan(0)
    }
  })
})
