import type { Metadata } from "next"

import { ComingSoonStructuredData } from "@components/coming-soon/coming-soon-structured-data"
import { ComingSoonView } from "@components/coming-soon/coming-soon-view"
import { createComingSoonMetadata } from "@lib/seo/coming-soon"

export const metadata: Metadata = createComingSoonMetadata()

/**
 * Country-aware entry point for the coming-soon page. The middleware guarantees
 * a valid `countryCode` prefix (redirecting `/coming-soon` to `/{country}/coming-soon`),
 * so the shared view can build locale-aware links from it.
 */
export default async function ComingSoonPage(props: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await props.params
  return (
    <>
      <ComingSoonStructuredData />
      <ComingSoonView countryCode={countryCode} />
    </>
  )
}
