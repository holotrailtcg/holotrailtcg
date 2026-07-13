import { describe, expect, it } from "vitest"

import {
  decideConsent,
  parseConsent,
  serializeConsent,
} from "./store"
import { CONSENT_VERSION, DEFAULT_CONSENT } from "./types"

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

  it("never treats a string boolean as an analytics approval", () => {
    const state = parseConsent(
      JSON.stringify({
        categories: { essential: true, analytics: "true" },
        decided: "true",
        version: CONSENT_VERSION,
      })
    )
    expect(state.categories.analytics).toBe(false)
    expect(state.decided).toBe(false)
  })

  it("defaults when a category is missing", () => {
    const state = parseConsent(
      JSON.stringify({
        categories: { essential: true },
        decided: true,
        version: CONSENT_VERSION,
      })
    )
    expect(state.categories.analytics).toBe(false)
    expect(state.decided).toBe(false)
  })

  it("defaults when essential is not exactly true", () => {
    const state = parseConsent(
      JSON.stringify({
        categories: { essential: false, analytics: true },
        decided: true,
        version: CONSENT_VERSION,
      })
    )
    expect(state.categories.analytics).toBe(false)
  })

  it("defaults when decided is the wrong type", () => {
    const state = parseConsent(
      JSON.stringify({
        categories: { essential: true, analytics: true },
        decided: 1,
        version: CONSENT_VERSION,
      })
    )
    expect(state.categories.analytics).toBe(false)
    expect(state.decided).toBe(false)
  })

  it("defaults when categories is not an object", () => {
    const state = parseConsent(
      JSON.stringify({
        categories: "yes",
        decided: true,
        version: CONSENT_VERSION,
      })
    )
    expect(state.categories.analytics).toBe(false)
  })

  it("defaults for a wrong version type (string instead of number)", () => {
    const state = parseConsent(
      JSON.stringify({
        categories: { essential: true, analytics: true },
        decided: true,
        version: String(CONSENT_VERSION),
      })
    )
    expect(state.categories.analytics).toBe(false)
  })

  it("defaults when decidedAt is a malformed timestamp", () => {
    const state = parseConsent(
      JSON.stringify({
        categories: { essential: true, analytics: true },
        decided: true,
        decidedAt: "not-a-date",
        version: CONSENT_VERSION,
      })
    )
    expect(state.categories.analytics).toBe(false)
    expect(state.decided).toBe(false)
  })

  it("defaults when decidedAt is a loosely-parseable non-ISO string", () => {
    const state = parseConsent(
      JSON.stringify({
        categories: { essential: true, analytics: true },
        decided: true,
        decidedAt: "2020",
        version: CONSENT_VERSION,
      })
    )
    expect(state.categories.analytics).toBe(false)
  })

  it("defaults for a JSON array", () => {
    expect(parseConsent("[]").categories.analytics).toBe(false)
  })

  it("accepts a valid stored decision with a valid ISO timestamp", () => {
    const decidedAt = new Date().toISOString()
    const state = parseConsent(
      JSON.stringify({
        categories: { essential: true, analytics: true },
        decided: true,
        decidedAt,
        version: CONSENT_VERSION,
      })
    )
    expect(state.categories.analytics).toBe(true)
    expect(state.decided).toBe(true)
    expect(state.decidedAt).toBe(decidedAt)
  })
})

describe("parseConsent semantic invariants", () => {
  it("defaults when undecided but analytics is true", () => {
    const state = parseConsent(
      JSON.stringify({
        categories: { essential: true, analytics: true },
        decided: false,
        version: CONSENT_VERSION,
      })
    )
    expect(state).toEqual(DEFAULT_CONSENT)
  })

  it("defaults when undecided but a decidedAt is present", () => {
    const state = parseConsent(
      JSON.stringify({
        categories: { essential: true, analytics: false },
        decided: false,
        decidedAt: new Date().toISOString(),
        version: CONSENT_VERSION,
      })
    )
    expect(state).toEqual(DEFAULT_CONSENT)
  })

  it("defaults when decided but decidedAt is missing", () => {
    const state = parseConsent(
      JSON.stringify({
        categories: { essential: true, analytics: false },
        decided: true,
        version: CONSENT_VERSION,
      })
    )
    expect(state).toEqual(DEFAULT_CONSENT)
  })

  it("defaults when decided but decidedAt is invalid", () => {
    const state = parseConsent(
      JSON.stringify({
        categories: { essential: true, analytics: false },
        decided: true,
        decidedAt: "not-a-date",
        version: CONSENT_VERSION,
      })
    )
    expect(state).toEqual(DEFAULT_CONSENT)
  })

  it("accepts decided true, analytics true, with a valid decidedAt", () => {
    const decidedAt = new Date().toISOString()
    const state = parseConsent(
      JSON.stringify({
        categories: { essential: true, analytics: true },
        decided: true,
        decidedAt,
        version: CONSENT_VERSION,
      })
    )
    expect(state).toEqual({
      categories: { essential: true, analytics: true },
      decided: true,
      decidedAt,
      version: CONSENT_VERSION,
    })
  })

  it("accepts decided true, analytics false, with a valid decidedAt", () => {
    const decidedAt = new Date().toISOString()
    const state = parseConsent(
      JSON.stringify({
        categories: { essential: true, analytics: false },
        decided: true,
        decidedAt,
        version: CONSENT_VERSION,
      })
    )
    expect(state).toEqual({
      categories: { essential: true, analytics: false },
      decided: true,
      decidedAt,
      version: CONSENT_VERSION,
    })
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
