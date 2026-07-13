import { describe, expect, it } from "vitest"

import { resolveComingSoonMode } from "./config"

describe("resolveComingSoonMode", () => {
  it("returns true for the exact string \"true\"", () => {
    expect(resolveComingSoonMode({ COMING_SOON_MODE: "true" })).toBe(true)
  })

  it("returns false for the exact string \"false\"", () => {
    expect(resolveComingSoonMode({ COMING_SOON_MODE: "false" })).toBe(false)
  })

  it("fails closed (gates) when the variable is unset", () => {
    expect(resolveComingSoonMode({})).toBe(true)
  })

  it("fails closed (gates) when the variable is an empty string", () => {
    expect(resolveComingSoonMode({ COMING_SOON_MODE: "" })).toBe(true)
  })

  it.each(["TRUE", "True", "1", "yes", "on", " true", "true "])(
    "fails closed (gates) for the malformed value %j",
    (value) => {
      expect(resolveComingSoonMode({ COMING_SOON_MODE: value })).toBe(true)
    },
  )

  it.each(["FALSE", "False", "0", "no", "off"])(
    "fails closed (gates) for the malformed value %j (does not treat it as false)",
    (value) => {
      expect(resolveComingSoonMode({ COMING_SOON_MODE: value })).toBe(true)
    },
  )
})
