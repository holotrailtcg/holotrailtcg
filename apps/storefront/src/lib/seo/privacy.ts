import type { Metadata } from "next"

import { PRIVACY_NOTICE_INDEXABLE } from "@content/privacy"
import { getBaseURL } from "@lib/util/env"

export function createPrivacyMetadata(baseUrl = getBaseURL()): Metadata {
  return {
    title: "Privacy Notice — Holo Trail TCG",
    description:
      "How Holo Trail TCG uses and protects personal information collected through its coming-soon website and mailing list.",
    alternates: {
      canonical: new URL("/gb/privacy", baseUrl).toString(),
    },
    robots: {
      index: PRIVACY_NOTICE_INDEXABLE,
      follow: PRIVACY_NOTICE_INDEXABLE,
    },
  }
}
