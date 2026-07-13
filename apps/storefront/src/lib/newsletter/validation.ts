import type { NewsletterFieldErrors, NewsletterFormFields } from "./types"

/**
 * Pure, framework-free validation helpers for the newsletter form. Shared by
 * the UI now and re-usable by the Stage 2C API route for server-side checks.
 * Keep these dependency-free so they are cheap to unit test.
 */

export const FIRST_NAME_MAX = 50

/**
 * Practical maximum email length. RFC 5321 caps the whole address (the SMTP
 * forward/reverse path) at 254 characters, so we reject anything longer both
 * here and via the input's `maxLength`. This is a length guard only; shape is
 * checked separately and the Stage 2C backend remains the source of truth.
 */
export const EMAIL_MAX = 254

// Pragmatic email shape check. Full RFC validation is neither necessary nor
// desirable client-side; the Stage 2C backend remains the source of truth.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateFirstName(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return "Enter your first name."
  }
  if (trimmed.length > FIRST_NAME_MAX) {
    return `First name must be ${FIRST_NAME_MAX} characters or fewer.`
  }
  return undefined
}

export function validateEmail(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return "Enter your email address."
  }
  if (trimmed.length > EMAIL_MAX) {
    return `Email address must be ${EMAIL_MAX} characters or fewer.`
  }
  if (!EMAIL_PATTERN.test(trimmed)) {
    return "Enter a valid email address."
  }
  return undefined
}

export function validateConsent(value: boolean): string | undefined {
  if (value !== true) {
    return "Please tick the box to agree to receive emails."
  }
  return undefined
}

/** Validate the whole submission; returns only the fields that have errors. */
export function validateSubmission(
  submission: NewsletterFormFields,
): NewsletterFieldErrors {
  const errors: NewsletterFieldErrors = {}

  const firstName = validateFirstName(submission.firstName)
  if (firstName) errors.firstName = firstName

  const email = validateEmail(submission.email)
  if (email) errors.email = email

  const consent = validateConsent(submission.consent)
  if (consent) errors.consent = consent

  return errors
}

export function hasErrors(errors: NewsletterFieldErrors): boolean {
  return Object.keys(errors).length > 0
}
