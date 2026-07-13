export const NEWSLETTER_RECAPTCHA_ACTION = "newsletter_subscribe" as const

export type RecaptchaApi = {
  ready(callback: () => void): void
  execute(siteKey: string, options: { action: string }): Promise<string>
}

declare global {
  interface Window {
    grecaptcha?: RecaptchaApi
  }
}

let scriptState: "loading" | "ready" | "failed" = "loading"
let settleScript: (() => void) | undefined
let rejectScript: ((error: Error) => void) | undefined
let scriptPromise = createScriptPromise()
scriptPromise.catch(() => {})

function createScriptPromise(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    settleScript = resolve
    rejectScript = reject
  })
}

export function markRecaptchaScriptReady(): void {
  scriptState = "ready"
  settleScript?.()
}

export function markRecaptchaScriptFailed(): void {
  scriptState = "failed"
  rejectScript?.(new Error("reCAPTCHA script unavailable"))
}

function waitForScript(): Promise<void> {
  if (scriptState === "ready") return Promise.resolve()
  if (scriptState === "failed") {
    return Promise.reject(new Error("reCAPTCHA script unavailable"))
  }
  return scriptPromise
}

export function createRecaptchaClient({
  siteKey,
  getApi = () => window.grecaptcha,
  waitUntilLoaded = waitForScript,
}: {
  siteKey: string | undefined
  getApi?: () => RecaptchaApi | undefined
  waitUntilLoaded?: () => Promise<void>
}) {
  if (!siteKey?.trim()) {
    throw new Error("NEXT_PUBLIC_RECAPTCHA_SITE_KEY is required")
  }

  return {
    async executeNewsletterToken(): Promise<string> {
      await waitUntilLoaded()
      const api = getApi()
      if (!api) throw new Error("reCAPTCHA API unavailable")

      await new Promise<void>((resolve) => api.ready(resolve))
      const token = await api.execute(siteKey, {
        action: NEWSLETTER_RECAPTCHA_ACTION,
      })
      if (!token) throw new Error("reCAPTCHA returned no token")
      return token
    },
  }
}

/** Test-only reset for the module-level script readiness latch. */
export function resetRecaptchaScriptStateForTests(): void {
  scriptState = "loading"
  scriptPromise = createScriptPromise()
  scriptPromise.catch(() => {})
}
