import type { MetadataRoute } from "next"

import { PRIVACY_NOTICE_INDEXABLE } from "@content/privacy"
import { resolveComingSoonMode } from "@lib/coming-soon/config"
import { COMING_SOON_PATH } from "@lib/seo/coming-soon"
import { getBaseURL } from "@lib/util/env"

interface SitemapOptions {
  baseUrl: string
  comingSoonMode: boolean
  privacyIndexable: boolean
}

export function createSitemap({
  baseUrl,
  comingSoonMode,
  privacyIndexable,
}: SitemapOptions): MetadataRoute.Sitemap {
  const privacyEntry: MetadataRoute.Sitemap[number] = {
    url: `${baseUrl}/gb/privacy`,
    changeFrequency: "monthly",
    priority: 0.3,
  }

  if (comingSoonMode) {
    return [
      {
        url: `${baseUrl}${COMING_SOON_PATH}`,
        changeFrequency: "weekly",
        priority: 0.8,
      },
      ...(privacyIndexable ? [privacyEntry] : []),
    ]
  }

  return [
    {
      url: `${baseUrl}/gb`,
      changeFrequency: "daily",
      priority: 1,
    },
    ...(privacyIndexable ? [privacyEntry] : []),
  ]
}

export default function sitemap(): MetadataRoute.Sitemap {
  return createSitemap({
    baseUrl: getBaseURL(),
    comingSoonMode: resolveComingSoonMode(),
    privacyIndexable: PRIVACY_NOTICE_INDEXABLE,
  })
}
