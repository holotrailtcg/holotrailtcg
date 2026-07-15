import { describe, expect, it } from "vitest"

import { COMING_SOON_SOCIAL_IMAGE_ALT } from "@lib/seo/coming-soon"

import { alt, contentType, size } from "./opengraph-image"

describe("coming-soon social preview", () => {
  it("is a dedicated 1200 by 630 PNG with descriptive alt text", () => {
    expect(size).toEqual({ width: 1200, height: 630 })
    expect(contentType).toBe("image/png")
    expect(alt).toBe(COMING_SOON_SOCIAL_IMAGE_ALT)
  })
})
