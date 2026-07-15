import { describe, expect, it } from "vitest"

import { createPrivacyMetadata } from "./privacy"

describe("privacy metadata", () => {
  it("uses accurate metadata and remains noindex while publication details are blocked", () => {
    const metadata = createPrivacyMetadata("https://www.holotrailtcg.example")

    expect(metadata.title).toBe("Privacy Notice — Holo Trail TCG")
    expect(metadata.description).not.toMatch(/placeholder|being prepared/i)
    expect(metadata.alternates).toEqual({
      canonical: "https://www.holotrailtcg.example/gb/privacy",
    })
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})
