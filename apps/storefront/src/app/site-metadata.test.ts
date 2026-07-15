import { describe, expect, it } from "vitest"

import { createRobots } from "./robots"
import { createSitemap } from "./sitemap"

const BASE_URL = "https://www.holotrailtcg.example"

describe("robots metadata", () => {
  it("allows crawling, protects private routes and references the sitemap", () => {
    const robots = createRobots(BASE_URL)

    expect(robots.sitemap).toBe(`${BASE_URL}/sitemap.xml`)
    expect(robots.host).toBe(BASE_URL)
    expect(robots.rules).toMatchObject({
      userAgent: "*",
      allow: "/",
    })
    expect(JSON.stringify(robots)).not.toContain("/gb/coming-soon")
    expect(JSON.stringify(robots)).toContain("/*/checkout")
    expect(JSON.stringify(robots)).toContain("/*/account")
    expect(JSON.stringify(robots)).toContain("/*/newsletter/confirm")
    expect(JSON.stringify(robots)).toContain("/*/newsletter/unsubscribe")
  })
})

describe("sitemap metadata", () => {
  it("contains only the canonical coming-soon URL while gated", () => {
    const sitemap = createSitemap({
      baseUrl: BASE_URL,
      comingSoonMode: true,
      privacyIndexable: false,
    })

    expect(sitemap).toEqual([
      {
        url: `${BASE_URL}/gb/coming-soon`,
        changeFrequency: "weekly",
        priority: 0.8,
      },
    ])
    expect(JSON.stringify(sitemap)).not.toMatch(
      /newsletter|account|checkout|products|store/
    )
  })

  it("includes privacy only when its notice is indexable", () => {
    const sitemap = createSitemap({
      baseUrl: BASE_URL,
      comingSoonMode: true,
      privacyIndexable: true,
    })

    expect(sitemap.map((entry) => entry.url)).toEqual([
      `${BASE_URL}/gb/coming-soon`,
      `${BASE_URL}/gb/privacy`,
    ])
  })

  it("switches away from the coming-soon URL when the gate is disabled", () => {
    const sitemap = createSitemap({
      baseUrl: BASE_URL,
      comingSoonMode: false,
      privacyIndexable: false,
    })

    expect(sitemap.map((entry) => entry.url)).toEqual([`${BASE_URL}/gb`])
  })
})
