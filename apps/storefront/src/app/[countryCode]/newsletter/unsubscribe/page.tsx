import type { Metadata } from "next"

import { NewsletterResultView } from "@components/newsletter/result-view"
import { UrlCleanup } from "@components/newsletter/url-cleanup"
import type { UnsubscribeResult } from "@lib/newsletter/result-api"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "Unsubscribe — Holo Trail TCG",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
}

export default async function NewsletterUnsubscribePage({
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
  const cleanPathname = `/${countryCode}/newsletter/unsubscribe`

  const result =
    typeof query.result === "string" &&
    ["unsubscribed", "already_unsubscribed", "invalid", "temporary_error"].includes(
      query.result,
    )
      ? query.result
      : "invalid"

  return (
    <>
      <NewsletterResultView
        countryCode={countryCode}
        type="unsubscribe"
        result={result as UnsubscribeResult}
      />
      <UrlCleanup cleanPathname={cleanPathname} />
    </>
  )
}
