import type { Metadata } from "next"

import { NewsletterResultView } from "@components/newsletter/result-view"
import { UrlCleanup } from "@components/newsletter/url-cleanup"
import { getUnsubscribeResult } from "@lib/newsletter/result-api"

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
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const [{ countryCode }, query] = await Promise.all([params, searchParams])
  const token = typeof query.token === "string" ? query.token : undefined
  const result = await getUnsubscribeResult(token)
  const cleanPathname = `/${countryCode}/newsletter/unsubscribe`

  return (
    <>
      <NewsletterResultView
        countryCode={countryCode}
        type="unsubscribe"
        result={result}
      />
      <UrlCleanup cleanPathname={cleanPathname} />
    </>
  )
}
