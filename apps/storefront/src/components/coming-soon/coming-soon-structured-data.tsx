import { socialLinks } from "@content/social"
import {
  COMING_SOON_DESCRIPTION,
  getComingSoonCanonicalUrl,
} from "@lib/seo/coming-soon"
import { getBaseURL } from "@lib/util/env"

function validPublicProfileUrls() {
  return socialLinks.flatMap(({ href }) => {
    try {
      const url = new URL(href)
      return url.protocol === "https:" ? [url.toString()] : []
    } catch {
      return []
    }
  })
}

export function createComingSoonStructuredData(baseUrl = getBaseURL()) {
  const canonical = getComingSoonCanonicalUrl(baseUrl)
  const storeId = `${canonical}#online-store`
  const websiteId = `${canonical}#website`

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "OnlineStore",
        "@id": storeId,
        name: "Holo Trail TCG",
        url: canonical,
        description: COMING_SOON_DESCRIPTION,
        logo: new URL("/brand/holotrailtcg-icon-logo.png", baseUrl).toString(),
        sameAs: validPublicProfileUrls(),
      },
      {
        "@type": "WebSite",
        "@id": websiteId,
        url: canonical,
        name: "Holo Trail TCG",
        publisher: {
          "@id": storeId,
        },
        inLanguage: "en-GB",
      },
    ],
  }
}

export function serialiseStructuredData(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c")
}

export function ComingSoonStructuredData() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: serialiseStructuredData(createComingSoonStructuredData()),
      }}
    />
  )
}
