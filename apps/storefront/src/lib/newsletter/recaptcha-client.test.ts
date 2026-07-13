import { describe, expect, it, vi } from "vitest"

import {
  createRecaptchaClient,
  NEWSLETTER_RECAPTCHA_ACTION,
  type RecaptchaApi,
} from "./recaptcha-client"

describe("reCAPTCHA v3 client", () => {
  it("waits for readiness and executes the newsletter action once", async () => {
    const execute = vi.fn(async () => "fresh-token")
    const api: RecaptchaApi = { ready: (callback) => callback(), execute }
    const waitUntilLoaded = vi.fn(async () => {})
    const client = createRecaptchaClient({
      siteKey: "public-site-key",
      getApi: () => api,
      waitUntilLoaded,
    })

    await expect(client.executeNewsletterToken()).resolves.toBe("fresh-token")
    expect(waitUntilLoaded).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledOnce()
    expect(execute).toHaveBeenCalledWith("public-site-key", {
      action: NEWSLETTER_RECAPTCHA_ACTION,
    })
  })

  it("fails closed when the public site key is missing", () => {
    expect(() => createRecaptchaClient({ siteKey: undefined })).toThrow(
      "NEXT_PUBLIC_RECAPTCHA_SITE_KEY is required",
    )
  })

  it("surfaces script failure safely without executing or logging a token", async () => {
    const execute = vi.fn()
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ]
    const client = createRecaptchaClient({
      siteKey: "public-site-key",
      getApi: () => ({ ready: (callback) => callback(), execute }),
      waitUntilLoaded: async () => {
        throw new Error("script failed")
      },
    })

    await expect(client.executeNewsletterToken()).rejects.toThrow(
      "script failed",
    )
    expect(execute).not.toHaveBeenCalled()
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
