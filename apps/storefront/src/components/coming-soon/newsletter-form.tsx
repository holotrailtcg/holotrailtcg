"use client"

import * as React from "react"

import { comingSoonContent } from "@content/coming-soon"
import {
  newsletterAdapter,
  validateSubmission,
  hasErrors,
  EMAIL_MAX,
  FIRST_NAME_MAX,
  type NewsletterFieldErrors,
} from "@lib/newsletter"
import { Alert } from "@components/ui/alert"
import { Button } from "@components/ui/button"
import { Checkbox } from "@components/ui/checkbox"
import { FormField } from "@components/ui/form-field"
import { Input } from "@components/ui/input"
import { Label } from "@components/ui/label"

type Status = "idle" | "submitting" | "success" | "error"

const { form: copy, privacyNote } = comingSoonContent

/**
 * Coming-soon newsletter form. This is the page's single client island.
 * UI only: it talks to `newsletterAdapter` (a development-safe placeholder
 * until Stage 2C), never to a backend directly.
 */
export function NewsletterForm({
  privacyHref = "/privacy",
}: {
  privacyHref?: string
}) {
  const [firstName, setFirstName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [consent, setConsent] = React.useState(false)
  const [errors, setErrors] = React.useState<NewsletterFieldErrors>({})
  const [status, setStatus] = React.useState<Status>("idle")

  const firstNameRef = React.useRef<HTMLInputElement>(null)
  const emailRef = React.useRef<HTMLInputElement>(null)
  const consentRef = React.useRef<HTMLInputElement>(null)
  const successRef = React.useRef<HTMLDivElement>(null)

  // Move focus to the confirmation once submission succeeds.
  React.useEffect(() => {
    if (status === "success") {
      successRef.current?.focus()
    }
  }, [status])

  function focusFirstError(fieldErrors: NewsletterFieldErrors) {
    if (fieldErrors.firstName) firstNameRef.current?.focus()
    else if (fieldErrors.email) emailRef.current?.focus()
    else if (fieldErrors.consent) consentRef.current?.focus()
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status === "submitting") return

    const submission = { firstName, email, consent }
    const fieldErrors = validateSubmission(submission)

    if (hasErrors(fieldErrors)) {
      setErrors(fieldErrors)
      setStatus("idle")
      focusFirstError(fieldErrors)
      return
    }

    setErrors({})
    setStatus("submitting")

    try {
      const result = await newsletterAdapter.submit({
        firstName: firstName.trim(),
        email: email.trim(),
        consent,
      })

      if (result.status === "success") {
        setStatus("success")
        setFirstName("")
        setEmail("")
        setConsent(false)
      } else {
        setStatus("error")
      }
    } catch {
      setStatus("error")
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
          {copy.successBody}
        </Alert>
      </div>
    )
  }

  const consentErrorId = errors.consent ? "consent-error" : undefined

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
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
        <Alert variant="error" title={copy.errorTitle}>
          {copy.errorBody}
        </Alert>
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
