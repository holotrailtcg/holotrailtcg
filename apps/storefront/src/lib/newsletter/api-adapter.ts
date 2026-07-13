import type {
  NewsletterAdapter,
  NewsletterResult,
  NewsletterSubmission,
} from "./types"

const backendUrl = process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL
const publishableKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY

function mapResponseStatus(status: number): NewsletterResult {
  if (status >= 200 && status < 300) return { status: "success" }
  if (status === 400) return { status: "validation_failure" }
  if (status === 403) return { status: "verification_failure" }
  if (status === 429) return { status: "rate_limited" }
  return { status: "temporarily_unavailable" }
}

export function createNewsletterAdapter({
  baseUrl,
  publishableApiKey,
  fetchImpl = fetch,
}: {
  baseUrl: string | undefined
  publishableApiKey: string | undefined
  fetchImpl?: typeof fetch
}): NewsletterAdapter {
  return {
    async submit(submission: NewsletterSubmission): Promise<NewsletterResult> {
      if (!baseUrl || !publishableApiKey || submission.consent !== true) {
        return { status: "validation_failure" }
      }

      try {
        const response = await fetchImpl(
          new URL("/store/newsletter/subscribe", baseUrl),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-publishable-api-key": publishableApiKey,
            },
            body: JSON.stringify({
              firstName: submission.firstName,
              email: submission.email,
              consent: true,
              honeypot: submission.honeypot,
              recaptchaToken: submission.recaptchaToken,
              countryCode: submission.countryCode,
            }),
          },
        )

        return mapResponseStatus(response.status)
      } catch {
        return { status: "temporarily_unavailable" }
      }
    },
  }
}

export const apiNewsletterAdapter = createNewsletterAdapter({
  baseUrl: backendUrl,
  publishableApiKey: publishableKey,
})
