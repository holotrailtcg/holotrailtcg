import { existsSync, statSync } from "node:fs"
import { join } from "node:path"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  COMING_SOON_BUILDING_IMAGE_PATH,
  COMING_SOON_HERO_IMAGE_PATH,
  COMING_SOON_IMAGE_BUDGETS,
} from "./coming-soon-images"
import { ComingSoonView } from "./coming-soon-view"

function publicFile(publicPath: string) {
  return join(process.cwd(), "public", publicPath.replace(/^\//, ""))
}

describe("coming-soon image assets", () => {
  it.each([
    [COMING_SOON_HERO_IMAGE_PATH, COMING_SOON_IMAGE_BUDGETS.heroBytes],
    [COMING_SOON_BUILDING_IMAGE_PATH, COMING_SOON_IMAGE_BUDGETS.buildingBytes],
  ])("keeps %s present and within its byte budget", (path, budget) => {
    const file = publicFile(path)
    expect(existsSync(file)).toBe(true)
    expect(statSync(file).size).toBeLessThan(budget)
  })

  it("renders the compressed WebP paths and not the source JPEGs", () => {
    const html = renderToStaticMarkup(
      React.createElement(ComingSoonView, { countryCode: "gb" })
    )

    expect(html).toContain(encodeURIComponent(COMING_SOON_HERO_IMAGE_PATH))
    expect(html).toContain(encodeURIComponent(COMING_SOON_BUILDING_IMAGE_PATH))
    expect(html).not.toContain("thimo-pedersen-TWCnHKKhqSo-unsplash.jpg")
    expect(html).not.toContain("halfcut-pokemon-WrUGh2DXfiw-unsplash.jpg")
  })
})
