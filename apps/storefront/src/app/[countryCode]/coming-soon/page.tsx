import type { Metadata } from "next"

import { ComingSoonView } from "@components/coming-soon/coming-soon-view"

export const metadata: Metadata = {
  title: "Holo Trail TCG — Coming soon",
  description:
    "Holo Trail TCG is a specialist home for collectable trading cards. Join the list for launch and stock updates.",
}

/**
 * Country-aware entry point for the coming-soon page. The middleware guarantees
 * a valid `countryCode` prefix (redirecting `/coming-soon` to `/{country}/coming-soon`),
 * so the shared view can build locale-aware links from it.
 */
export default async function ComingSoonPage(props: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await props.params
  return <ComingSoonView countryCode={countryCode} />
}
