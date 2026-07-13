import type { Metadata } from "next"

import { NewsletterResultView } from "@components/newsletter/result-view"
import { UrlCleanup } from "@components/newsletter/url-cleanup"
import type { ConfirmationResult } from "@lib/newsletter/result-api"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "Confirm your email — Holo Trail TCG",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
}

export default async function NewsletterConfirmPage({
  params,
  searchParams,
}: {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{
    token?: string | string[]
    result?: string | string[]
  }>
}) {
  const [{ countryCode }, query] = await Promise.all([params, searchParams])
  const cleanPathname = `/${countryCode}/newsletter/confirm`

  const result =
    typeof query.result === "string" &&
    ["confirmed", "already_confirmed", "invalid_or_expired", "temporary_error"].includes(
      query.result,
    )
      ? query.result
      : "invalid_or_expired"

  return (
    <>
      <NewsletterResultView
        countryCode={countryCode}
        type="confirmation"
        result={result as ConfirmationResult}
      />
      <UrlCleanup cleanPathname={cleanPathname} />
    </>
  )
}
