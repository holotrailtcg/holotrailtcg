import type {
  NewsletterAdapter,
  NewsletterFieldErrors,
  NewsletterResult,
} from "./types"
import { hasErrors, validateSubmission } from "./validation"

export type NewsletterFormValues = {
  firstName: string
  email: string
  consent: boolean
  honeypot: string
}

export type NewsletterSubmissionOutcome =
  | { kind: "validation_failure"; errors: NewsletterFieldErrors }
  | { kind: "submitted"; result: NewsletterResult }
  | { kind: "verification_failure" }

export function acquireSubmissionLock(lock: { current: boolean }): boolean {
  if (lock.current) return false
  lock.current = true
  return true
}

/**
 * The form's security-sensitive processing order, kept framework-free so it
 * can be tested with injected boundaries and without contacting Google.
 */
export async function processNewsletterSubmission({
  values,
  countryCode,
  getRecaptchaToken,
  adapter,
}: {
  values: NewsletterFormValues
  countryCode: string
  getRecaptchaToken: () => Promise<string>
  adapter: NewsletterAdapter
}): Promise<NewsletterSubmissionOutcome> {
  const errors = validateSubmission(values)
  if (hasErrors(errors) || values.consent !== true) {
    return { kind: "validation_failure", errors }
  }

  let recaptchaToken: string
  try {
    recaptchaToken = await getRecaptchaToken()
    if (!recaptchaToken) return { kind: "verification_failure" }
  } catch {
    return { kind: "verification_failure" }
  }

  const result = await adapter.submit({
    firstName: values.firstName.trim(),
    email: values.email.trim(),
    consent: true,
    honeypot: values.honeypot,
    recaptchaToken,
    countryCode,
  })

  return { kind: "submitted", result }
}
