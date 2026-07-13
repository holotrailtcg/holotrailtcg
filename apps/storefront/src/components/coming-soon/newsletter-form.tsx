"use client"

import * as React from "react"

import { comingSoonContent } from "@content/coming-soon"
import {
  newsletterAdapter,
  processNewsletterSubmission,
  acquireSubmissionLock,
  validateSubmission,
  hasErrors,
  EMAIL_MAX,
  FIRST_NAME_MAX,
  type NewsletterFieldErrors,
} from "@lib/newsletter"
import { createRecaptchaClient } from "@lib/newsletter/recaptcha-client"
import { Alert } from "@components/ui/alert"
import { Button } from "@components/ui/button"
import { Checkbox } from "@components/ui/checkbox"
import { FormField } from "@components/ui/form-field"
import { Input } from "@components/ui/input"
import { Label } from "@components/ui/label"

type Status = "idle" | "submitting" | "success" | "error"
type ErrorKind =
  | "verification_failure"
  | "rate_limited"
  | "temporarily_unavailable"

const { form: copy, privacyNote } = comingSoonContent

/**
 * Coming-soon newsletter form. This is the page's single client island.
 * UI only: it talks to `newsletterAdapter`, never to a backend or provider
 * directly.
 */
export function NewsletterForm({
  countryCode,
  recaptchaSiteKey,
  privacyHref = "/privacy",
}: {
  countryCode: string
  recaptchaSiteKey: string
  privacyHref?: string
}) {
  const [firstName, setFirstName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [consent, setConsent] = React.useState(false)
  const [honeypot, setHoneypot] = React.useState("")
  const [errors, setErrors] = React.useState<NewsletterFieldErrors>({})
  const [status, setStatus] = React.useState<Status>("idle")
  const [errorKind, setErrorKind] = React.useState<ErrorKind>(
    "temporarily_unavailable",
  )

  const firstNameRef = React.useRef<HTMLInputElement>(null)
  const emailRef = React.useRef<HTMLInputElement>(null)
  const consentRef = React.useRef<HTMLInputElement>(null)
  const successRef = React.useRef<HTMLDivElement>(null)
  const errorRef = React.useRef<HTMLDivElement>(null)
  const submittingRef = React.useRef(false)

  // Move focus to the confirmation once submission succeeds.
  React.useEffect(() => {
    if (status === "success") {
      successRef.current?.focus()
    } else if (status === "error") {
      errorRef.current?.focus()
    }
  }, [status])

  function focusFirstError(fieldErrors: NewsletterFieldErrors) {
    if (fieldErrors.firstName) firstNameRef.current?.focus()
    else if (fieldErrors.email) emailRef.current?.focus()
    else if (fieldErrors.consent) consentRef.current?.focus()
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current) return

    const submission = { firstName, email, consent }
    const fieldErrors = validateSubmission(submission)

    if (hasErrors(fieldErrors)) {
      setErrors(fieldErrors)
      setStatus("idle")
      focusFirstError(fieldErrors)
      return
    }

    if (!acquireSubmissionLock(submittingRef)) return

    setErrors({})
    setStatus("submitting")

    try {
      const outcome = await processNewsletterSubmission({
        values: { firstName, email, consent, honeypot },
        countryCode,
        getRecaptchaToken: () =>
          createRecaptchaClient({
            siteKey: recaptchaSiteKey,
          }).executeNewsletterToken(),
        adapter: newsletterAdapter,
      })

      if (outcome.kind === "validation_failure") {
        setErrors(outcome.errors)
        setStatus("idle")
        focusFirstError(outcome.errors)
      } else if (outcome.kind === "verification_failure") {
        setErrorKind("verification_failure")
        setStatus("error")
      } else if (outcome.result.status === "success") {
        setStatus("success")
        setFirstName("")
        setEmail("")
        setConsent(false)
        setHoneypot("")
      } else {
        setErrorKind(
          outcome.result.status === "rate_limited"
            ? "rate_limited"
            : outcome.result.status === "verification_failure"
              ? "verification_failure"
              : "temporarily_unavailable",
        )
        setStatus("error")
      }
    } catch {
      setErrorKind("temporarily_unavailable")
      setStatus("error")
    } finally {
      submittingRef.current = false
    }
  }

  if (status === "success") {
    return (
      <div
        ref={successRef}
        tabIndex={-1}
        className="focus-visible:outline-none"
      >
        <Alert variant="success" title={copy.successTitle}>
          <p>{copy.successBody}</p>
          <p className="mt-2">{copy.successSupporting}</p>
        </Alert>
      </div>
    )
  }

  const consentErrorId = errors.consent ? "consent-error" : undefined

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <div className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden">
        <Label htmlFor="newsletter-contact-note">
          Leave this field empty. It is for automated abuse detection.
        </Label>
        <Input
          id="newsletter-contact-note"
          name="honeypot"
          type="text"
          autoComplete="off"
          tabIndex={-1}
          maxLength={200}
          value={honeypot}
          onChange={(event) => setHoneypot(event.target.value)}
          disabled={status === "submitting"}
        />
      </div>

      <FormField
        id="first-name"
        label={copy.firstNameLabel}
        required
        helpText={copy.firstNameHelp}
        error={errors.firstName}
      >
        {({ id, describedBy, hasError }) => (
          <Input
            id={id}
            ref={firstNameRef}
            name="firstName"
            type="text"
            autoComplete="given-name"
            maxLength={FIRST_NAME_MAX}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            aria-describedby={describedBy}
            hasError={hasError}
            disabled={status === "submitting"}
          />
        )}
      </FormField>

      <FormField
        id="email"
        label={copy.emailLabel}
        required
        helpText={copy.emailHelp}
        error={errors.email}
      >
        {({ id, describedBy, hasError }) => (
          <Input
            id={id}
            ref={emailRef}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={EMAIL_MAX}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby={describedBy}
            hasError={hasError}
            disabled={status === "submitting"}
          />
        )}
      </FormField>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-start gap-3">
          <Checkbox
            id="consent"
            ref={consentRef}
            name="consent"
            className="mt-1"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            aria-describedby={consentErrorId}
            aria-invalid={Boolean(errors.consent) || undefined}
            disabled={status === "submitting"}
          />
          <Label htmlFor="consent" className="font-normal">
            {copy.consentLabel}
          </Label>
        </div>
        {errors.consent && (
          <p id={consentErrorId} className="ht-body-sm text-danger">
            {errors.consent}
          </p>
        )}
      </div>

      {status === "error" && (
        <div
          ref={errorRef}
          tabIndex={-1}
          className="focus-visible:outline-none"
        >
          <Alert variant="error" title={copy.errorTitle}>
            {copy.errors[errorKind]}
          </Alert>
        </div>
      )}

      <Button type="submit" isLoading={status === "submitting"}>
        {copy.submitLabel}
      </Button>

      <p className="ht-caption">
        {privacyNote.lead}{" "}
        <a
          href={privacyHref}
          className="text-action underline underline-offset-2 hover:text-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-page"
        >
          {privacyNote.linkLabel}
        </a>
        .
      </p>

      {/* Polite status region for assistive tech (visually hidden). */}
      <p className="sr-only" role="status" aria-live="polite">
        {status === "submitting" ? "Submitting your details." : ""}
      </p>
    </form>
  )
}
