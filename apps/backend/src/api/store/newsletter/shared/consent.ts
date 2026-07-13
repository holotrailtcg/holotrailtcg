/**
 * Server-controlled consent metadata for newsletter signups.
 *
 * These values are deliberately never accepted from the client — consent
 * wording and its version are authoritative content the backend controls,
 * not user input (a client-supplied `consentTextVersion` would let a
 * caller claim consent to text it never saw). The Stage 2C.1 design
 * record sketched a client-supplied `consentTextVersion` kept in sync with
 * a backend env var; the Stage 2C.6 task brief's accepted-body field list
 * (`firstName`, `email`, `consent`, `honeypot`, `recaptchaToken`,
 * `countryCode`) does not include it, so this stage instead fixes both
 * values as source-controlled constants. See
 * docs/decisions/0005-newsletter-backend-design.md, Stage 2C.6 notes, for
 * the deviation record.
 *
 * Bump `NEWSLETTER_CONSENT_TEXT_VERSION` whenever the storefront's consent
 * copy changes.
 */
export const NEWSLETTER_CONSENT_TEXT_VERSION = "2026-07-13-v1"

/** Recorded on every subscriber row created via this route. */
export const NEWSLETTER_SIGNUP_SOURCE = "coming-soon"
