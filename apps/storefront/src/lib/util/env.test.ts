import { describe, expect, it } from "vitest"

import { resolveBaseURL } from "./env"

describe("resolveBaseURL", () => {
  it("accepts and normalises a production HTTPS origin", () => {
    expect(
      resolveBaseURL({
        NODE_ENV: "production",
        NEXT_PUBLIC_BASE_URL: "https://www.holotrailtcg.example/",
      })
    ).toBe("https://www.holotrailtcg.example")
  })

  it("accepts a localhost HTTP origin during development", () => {
    expect(
      resolveBaseURL({
        NODE_ENV: "development",
        NEXT_PUBLIC_BASE_URL: "http://localhost:8000/",
      })
    ).toBe("http://localhost:8000")
  })

  it("uses local HTTP when the development value is missing", () => {
    expect(resolveBaseURL({ NODE_ENV: "development" })).toBe(
      "http://localhost:8000"
    )
  })

  it.each([
    [undefined, /must be configured/],
    ["not a URL", /valid absolute HTTP URL/],
    ["http://www.holotrailtcg.example", /must use https/],
    ["https://localhost:8000", /must not use localhost/],
    ["https://preview-123.vercel.app", /real public domain/],
  ])("rejects unsafe production value %j", (value, expectedMessage) => {
    expect(() =>
      resolveBaseURL({
        NODE_ENV: "production",
        NEXT_PUBLIC_BASE_URL: value,
      })
    ).toThrow(expectedMessage)
  })

  it("rejects a path, query or fragment", () => {
    expect(() =>
      resolveBaseURL({
        NODE_ENV: "development",
        NEXT_PUBLIC_BASE_URL: "https://www.holotrailtcg.example/shop",
      })
    ).toThrow(/bare origin/)
  })
})
