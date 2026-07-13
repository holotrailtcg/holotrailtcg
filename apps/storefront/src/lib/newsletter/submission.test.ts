import { describe, expect, it, vi } from "vitest"

import type { NewsletterAdapter } from "./types"
import {
  acquireSubmissionLock,
  processNewsletterSubmission,
} from "./submission"

const validValues = {
  firstName: " Ash ",
  email: " ash@example.com ",
  consent: true,
  honeypot: "",
}

function adapter(status: "success" | "temporarily_unavailable" = "success") {
  return { submit: vi.fn(async () => ({ status })) } as NewsletterAdapter & {
    submit: ReturnType<typeof vi.fn>
  }
}

describe("newsletter form submission flow", () => {
  it.each([
    [{ ...validValues, firstName: "" }, "firstName"],
    [{ ...validValues, email: "invalid" }, "email"],
    [{ ...validValues, consent: false }, "consent"],
    [{ ...validValues, consent: "true" as unknown as boolean }, "consent"],
  ])("validates locally before requesting a token", async (values, field) => {
    const getRecaptchaToken = vi.fn(async () => "token")
    const result = await processNewsletterSubmission({
      values,
      countryCode: "gb",
      getRecaptchaToken,
      adapter: adapter(),
    })
    expect(result.kind).toBe("validation_failure")
    expect(
      result.kind === "validation_failure" && result.errors,
    ).toHaveProperty(field)
    expect(getRecaptchaToken).not.toHaveBeenCalled()
  })

  it("requests one token, then makes one backend request with honeypot and country", async () => {
    const calls: string[] = []
    const getRecaptchaToken = vi.fn(async () => {
      calls.push("recaptcha")
      return "token-one"
    })
    const api = adapter()
    api.submit.mockImplementation(async () => {
      calls.push("backend")
      return { status: "success" }
    })

    const result = await processNewsletterSubmission({
      values: validValues,
      countryCode: "gb",
      getRecaptchaToken,
      adapter: api,
    })
    expect(result).toEqual({ kind: "submitted", result: { status: "success" } })
    expect(calls).toEqual(["recaptcha", "backend"])
    expect(getRecaptchaToken).toHaveBeenCalledOnce()
    expect(api.submit).toHaveBeenCalledOnce()
    expect(api.submit).toHaveBeenCalledWith({
      firstName: "Ash",
      email: "ash@example.com",
      consent: true,
      honeypot: "",
      recaptchaToken: "token-one",
      countryCode: "gb",
    })
  })

  it("includes a bounded honeypot value when automation fills it", async () => {
    const api = adapter()
    await processNewsletterSubmission({
      values: { ...validValues, honeypot: "bot-value" },
      countryCode: "gb",
      getRecaptchaToken: async () => "token",
      adapter: api,
    })
    expect(api.submit.mock.calls[0][0].honeypot).toBe("bot-value")
  })

  it("obtains a fresh token on a deliberate retry after failure", async () => {
    const tokens = ["token-one", "token-two"]
    const getRecaptchaToken = vi.fn(async () => tokens.shift()!)
    const api = adapter("temporarily_unavailable")

    await processNewsletterSubmission({
      values: validValues,
      countryCode: "gb",
      getRecaptchaToken,
      adapter: api,
    })
    await processNewsletterSubmission({
      values: validValues,
      countryCode: "gb",
      getRecaptchaToken,
      adapter: api,
    })

    expect(getRecaptchaToken).toHaveBeenCalledTimes(2)
    expect(
      api.submit.mock.calls.map(([value]) => value.recaptchaToken),
    ).toEqual(["token-one", "token-two"])
  })

  it("prevents a second submit while the first owns the lock", () => {
    const lock = { current: false }
    expect(acquireSubmissionLock(lock)).toBe(true)
    expect(acquireSubmissionLock(lock)).toBe(false)
    lock.current = false
    expect(acquireSubmissionLock(lock)).toBe(true)
  })
})
