/**
 * Newsletter form-adapter boundary.
 *
 * The coming-soon form talks to a `NewsletterAdapter`, never directly to any
 * backend, database or email provider. The active adapter calls the public
 * Medusa newsletter endpoint and returns only conservative UI-safe outcomes.
 */

export type NewsletterFormFields = {
  firstName: string
  email: string
  consent: boolean
}

export type NewsletterSubmission = NewsletterFormFields & {
  honeypot: string
  recaptchaToken: string
  countryCode: string
}

/** Per-field validation errors. Absent keys mean the field is valid. */
export type NewsletterFieldErrors = Partial<
  Record<keyof NewsletterFormFields, string>
>

export type NewsletterResultStatus =
  | "success"
  | "validation_failure"
  | "verification_failure"
  | "rate_limited"
  | "temporarily_unavailable"

export type NewsletterResult = {
  status: NewsletterResultStatus
  /**
   * Duplicate-safe: a `success` result must not reveal whether the address was
   * already subscribed. The UI shows generic wording either way.
   */
}

export interface NewsletterAdapter {
  /**
   * Submit a validated subscription. Implementations must be duplicate-safe and
   * must not leak whether the address already existed. Throw or return
   * a conservative result for recoverable failures.
   */
  submit(submission: NewsletterSubmission): Promise<NewsletterResult>
}
