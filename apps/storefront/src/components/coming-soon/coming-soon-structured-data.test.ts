import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  ComingSoonStructuredData,
  createComingSoonStructuredData,
  serialiseStructuredData,
} from "./coming-soon-structured-data"

describe("coming-soon structured data", () => {
  it("renders one server-side JSON-LD graph with only OnlineStore and WebSite", () => {
    const html = renderToStaticMarkup(
      React.createElement(ComingSoonStructuredData)
    )
    const data = createComingSoonStructuredData(
      "https://www.holotrailtcg.example/"
    )

    expect(html.match(/type="application\/ld\+json"/g)).toHaveLength(1)
    expect(data["@context"]).toBe("https://schema.org")
    expect(data["@graph"].map((node) => node["@type"])).toEqual([
      "OnlineStore",
      "WebSite",
    ])
    expect(data["@graph"][0]).toMatchObject({
      "@id": "https://www.holotrailtcg.example/gb/coming-soon#online-store",
      url: "https://www.holotrailtcg.example/gb/coming-soon",
      logo: "https://www.holotrailtcg.example/brand/holotrailtcg-icon-logo.png",
      sameAs: [
        "https://www.facebook.com/holotrailtcg/about/",
        "https://www.instagram.com/holotrailtcg/",
      ],
    })
    expect(data["@graph"][1]).toMatchObject({
      "@id": "https://www.holotrailtcg.example/gb/coming-soon#website",
      inLanguage: "en-GB",
      publisher: {
        "@id": "https://www.holotrailtcg.example/gb/coming-soon#online-store",
      },
    })

    const json = JSON.stringify(data)
    expect(json).not.toMatch(
      /Product|Offer|Review|AggregateRating|FAQPage|SearchAction/
    )
  })

  it("escapes markup-significant script values", () => {
    expect(serialiseStructuredData({ value: "</script><script>" })).toBe(
      '{"value":"\\u003c/script>\\u003cscript>"}'
    )
  })
})
