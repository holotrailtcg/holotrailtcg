import { describe, expect, it, vi } from "vitest"

import { createNewsletterAdapter } from "./api-adapter"

const submission = {
  firstName: "Ash",
  email: "ash@example.com",
  consent: true,
  honeypot: "",
  recaptchaToken: "fresh-token",
  countryCode: "gb",
}

describe("newsletter API adapter", () => {
  it("posts exactly the backend contract once as JSON", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 202 }),
    )
    const adapter = createNewsletterAdapter({
      baseUrl: "https://backend.example",
      publishableApiKey: "pk_test",
      fetchImpl: fetchMock as typeof fetch,
    })

    await expect(adapter.submit(submission)).resolves.toEqual({
      status: "success",
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      "https://backend.example/store/newsletter/subscribe",
    )
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      "x-publishable-api-key": "pk_test",
    })
    expect(JSON.parse(String(init?.body))).toEqual(submission)
    expect(Object.keys(JSON.parse(String(init?.body)))).toEqual([
      "firstName",
      "email",
      "consent",
      "honeypot",
      "recaptchaToken",
      "countryCode",
    ])
    expect(String(init?.body)).not.toContain("consentVersion")
    expect(String(init?.body)).not.toContain("timestamp")
  })

  it.each([
    [400, "validation_failure"],
    [403, "verification_failure"],
    [429, "rate_limited"],
    [503, "temporarily_unavailable"],
  ] as const)("maps HTTP %s conservatively", async (status, expected) => {
    const adapter = createNewsletterAdapter({
      baseUrl: "https://backend.example",
      publishableApiKey: "pk_test",
      fetchImpl: vi.fn(async () => new Response(null, { status })),
    })
    await expect(adapter.submit(submission)).resolves.toEqual({
      status: expected,
    })
  })

  it("maps network failure without retrying or exposing personal data", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`provider rejected ${submission.email}`)
    })
    const adapter = createNewsletterAdapter({
      baseUrl: "https://backend.example",
      publishableApiKey: "pk_test",
      fetchImpl,
    })
    const result = await adapter.submit(submission)
    expect(result).toEqual({ status: "temporarily_unavailable" })
    expect(JSON.stringify(result)).not.toContain(submission.email)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("fails closed for missing configuration or non-literal consent", async () => {
    const fetchImpl = vi.fn()
    const adapter = createNewsletterAdapter({
      baseUrl: undefined,
      publishableApiKey: "pk_test",
      fetchImpl,
    })
    await expect(adapter.submit(submission)).resolves.toEqual({
      status: "validation_failure",
    })
    await expect(
      createNewsletterAdapter({
        baseUrl: "https://backend.example",
        publishableApiKey: "pk_test",
        fetchImpl,
      }).submit({
        ...submission,
        consent: "true" as unknown as boolean,
      }),
    ).resolves.toEqual({ status: "validation_failure" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
