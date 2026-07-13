import type { Metadata } from "next"

import { PrivacyView } from "@components/privacy/privacy-view"

export const metadata: Metadata = {
  title: "Privacy — Holo Trail TCG",
  description: "Our full privacy notice is being prepared.",
}

/**
 * Country-aware entry point for the privacy placeholder. The middleware
 * guarantees a valid `countryCode` prefix, so the shared view can build
 * locale-aware links from it.
 */
export default async function PrivacyPage(props: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await props.params
  return <PrivacyView countryCode={countryCode} />
}
