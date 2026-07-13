/**
 * Newsletter form-adapter boundary.
 *
 * The coming-soon form talks to a `NewsletterAdapter`, never directly to any
 * backend, database or email provider. Stage 2C provides a real adapter that
 * calls the storefront API route; until then a development-safe placeholder is
 * used (see dev-adapter.ts). The UI depends only on these types, so Stage 2C
 * can swap the adapter without changing the form.
 */

export type NewsletterSubmission = {
  firstName: string
  email: string
  consent: boolean
}

/** Per-field validation errors. Absent keys mean the field is valid. */
export type NewsletterFieldErrors = Partial<
  Record<keyof NewsletterSubmission, string>
>

export type NewsletterResultStatus = "success" | "error"

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
   * `{ status: "error" }` for recoverable failures.
   */
  submit(submission: NewsletterSubmission): Promise<NewsletterResult>
}
