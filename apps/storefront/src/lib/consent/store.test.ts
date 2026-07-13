import { describe, expect, it } from "vitest"

import {
  decideConsent,
  parseConsent,
  serializeConsent,
} from "./store"
import { CONSENT_VERSION } from "./types"

describe("parseConsent", () => {
  it("defaults to analytics rejected and undecided for missing input", () => {
    const state = parseConsent(null)
    expect(state.categories.analytics).toBe(false)
    expect(state.categories.essential).toBe(true)
    expect(state.decided).toBe(false)
  })

  it("falls back to the default for malformed JSON", () => {
    const state = parseConsent("{ not json")
    expect(state.decided).toBe(false)
    expect(state.categories.analytics).toBe(false)
  })

  it("re-prompts (defaults) when the stored version is old", () => {
    const stale = JSON.stringify({
      categories: { essential: true, analytics: true },
      decided: true,
      version: CONSENT_VERSION - 1,
    })
    const state = parseConsent(stale)
    expect(state.decided).toBe(false)
    expect(state.categories.analytics).toBe(false)
  })
})

describe("decideConsent + round trip", () => {
  it("records an accept decision that survives serialize/parse", () => {
    const decided = decideConsent(true)
    expect(decided.decided).toBe(true)
    expect(decided.categories.analytics).toBe(true)
    expect(decided.decidedAt).toBeDefined()

    const roundTripped = parseConsent(serializeConsent(decided))
    expect(roundTripped.categories.analytics).toBe(true)
    expect(roundTripped.decided).toBe(true)
    expect(roundTripped.version).toBe(CONSENT_VERSION)
  })

  it("records a reject decision with analytics off", () => {
    const decided = decideConsent(false)
    expect(decided.decided).toBe(true)
    expect(decided.categories.analytics).toBe(false)
  })
})
