import type { Metadata } from "next"

import { PrivacyView } from "@components/privacy/privacy-view"
import { createPrivacyMetadata } from "@lib/seo/privacy"

export const metadata: Metadata = createPrivacyMetadata()

/**
 * Country-aware entry point for the privacy notice. The middleware guarantees
 * a valid countryCode prefix so the shared view can build local links.
 */
export default async function PrivacyPage(props: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await props.params
  return <PrivacyView countryCode={countryCode} />
}
