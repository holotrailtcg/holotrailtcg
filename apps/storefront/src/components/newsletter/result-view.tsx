import Link from "next/link"

import { BrandLogo } from "@components/brand/brand-logo"
import { ContentContainer } from "@components/layout/content-container"
import { PageShell } from "@components/layout/page-shell"
import { Section } from "@components/layout/section"
import { Alert } from "@components/ui/alert"
import { buttonVariants } from "@components/ui/button"
import type {
  ConfirmationResult,
  UnsubscribeResult,
} from "@lib/newsletter/result-api"

type ResultCopy = {
  heading: string
  body: string
  variant: "success" | "info" | "warning" | "error"
}

const confirmationCopy: Record<ConfirmationResult, ResultCopy> = {
  confirmed: {
    heading: "Your email is confirmed",
    body: "You are now signed up for Holo Trail TCG updates.",
    variant: "success",
  },
  already_confirmed: {
    heading: "Your email is already confirmed",
    body: "No further action is needed.",
    variant: "info",
  },
  invalid_or_expired: {
    heading: "This confirmation link is no longer valid",
    body: "The link may have expired or already been replaced. You can return to the coming-soon page and subscribe again.",
    variant: "warning",
  },
  temporary_error: {
    heading: "We could not confirm your email",
    body: "Please try again later.",
    variant: "error",
  },
}

const unsubscribeCopy: Record<UnsubscribeResult, ResultCopy> = {
  unsubscribed: {
    heading: "You have been unsubscribed",
    body: "You will no longer receive Holo Trail TCG newsletter updates.",
    variant: "success",
  },
  already_unsubscribed: {
    heading: "You are already unsubscribed",
    body: "No further action is needed.",
    variant: "info",
  },
  invalid: {
    heading: "This unsubscribe link is not valid",
    body: "The link may no longer be active.",
    variant: "warning",
  },
  temporary_error: {
    heading: "We could not update your subscription",
    body: "Please try again later.",
    variant: "error",
  },
}

export function NewsletterResultView({
  countryCode,
  type,
  result,
}: {
  countryCode: string
  type: "confirmation" | "unsubscribe"
  result: ConfirmationResult | UnsubscribeResult
}) {
  const copy =
    type === "confirmation"
      ? confirmationCopy[result as ConfirmationResult]
      : unsubscribeCopy[result as UnsubscribeResult]
  const homeHref = `/${countryCode}/coming-soon`

  return (
    <PageShell surface="page">
      <ContentContainer as="header" className="py-6">
        <Link
          href={homeHref}
          aria-label="Holo Trail TCG home"
          className="inline-flex"
        >
          <BrandLogo variant="primary" height={36} />
        </Link>
      </ContentContainer>
      <ContentContainer className="flex flex-1 items-center">
        <Section spacing="md" className="mx-auto max-w-2xl">
          <div className="flex flex-col gap-6">
            <h1 className="ht-heading-page text-ink">{copy.heading}</h1>
            <Alert variant={copy.variant} aria-live="polite">
              {copy.body}
            </Alert>
            <div>
              <Link
                href={homeHref}
                className={buttonVariants({ variant: "primary" })}
              >
                Back to Holo Trail TCG
              </Link>
            </div>
          </div>
        </Section>
      </ContentContainer>
    </PageShell>
  )
}

export function NewsletterProcessingView() {
  return (
    <PageShell surface="page">
      <ContentContainer className="flex flex-1 items-center">
        <Section spacing="md" className="mx-auto max-w-2xl">
          <div className="flex flex-col gap-4">
            <h1 className="ht-heading-page text-ink">
              Processing your request
            </h1>
            <Alert variant="info" aria-live="polite">
              Please wait while we securely process your newsletter link.
            </Alert>
          </div>
        </Section>
      </ContentContainer>
    </PageShell>
  )
}
