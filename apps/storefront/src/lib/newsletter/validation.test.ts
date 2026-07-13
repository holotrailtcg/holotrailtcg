import { describe, expect, it } from "vitest"

import {
  FIRST_NAME_MAX,
  hasErrors,
  validateConsent,
  validateEmail,
  validateFirstName,
  validateSubmission,
} from "./validation"

describe("validateFirstName", () => {
  it("rejects empty and whitespace-only", () => {
    expect(validateFirstName("")).toBeDefined()
    expect(validateFirstName("   ")).toBeDefined()
  })

  it("rejects too short", () => {
    expect(validateFirstName("a")).toBeDefined()
  })

  it("rejects too long", () => {
    expect(validateFirstName("x".repeat(FIRST_NAME_MAX + 1))).toBeDefined()
  })

  it("accepts a normal name (trimmed)", () => {
    expect(validateFirstName("  Sam  ")).toBeUndefined()
  })
})

describe("validateEmail", () => {
  it("rejects empty and malformed", () => {
    expect(validateEmail("")).toBeDefined()
    expect(validateEmail("not-an-email")).toBeDefined()
    expect(validateEmail("a@b")).toBeDefined()
  })

  it("accepts a valid address", () => {
    expect(validateEmail("collector@holotrail.co.uk")).toBeUndefined()
  })
})

describe("validateConsent", () => {
  it("requires consent", () => {
    expect(validateConsent(false)).toBeDefined()
    expect(validateConsent(true)).toBeUndefined()
  })
})

describe("validateSubmission", () => {
  it("returns all three errors for an empty submission", () => {
    const errors = validateSubmission({
      firstName: "",
      email: "",
      consent: false,
    })
    expect(hasErrors(errors)).toBe(true)
    expect(Object.keys(errors).sort()).toEqual([
      "consent",
      "email",
      "firstName",
    ])
  })

  it("returns no errors for a valid submission", () => {
    const errors = validateSubmission({
      firstName: "Sam",
      email: "sam@example.com",
      consent: true,
    })
    expect(hasErrors(errors)).toBe(false)
    expect(errors).toEqual({})
  })
})
