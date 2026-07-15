import type { Metadata } from "next"

import { getBaseURL } from "@lib/util/env"

export const COMING_SOON_TITLE =
  "Pokémon Singles UK — Holo Trail TCG Coming Soon"

export const COMING_SOON_DESCRIPTION =
  "Holo Trail TCG is a new UK shop for Pokémon singles, with clear condition grading and secure UK delivery. Join the list for launch and stock updates."

export const COMING_SOON_PATH = "/gb/coming-soon"

export const COMING_SOON_SOCIAL_IMAGE_ALT =
  "Holo Trail TCG — Pokémon singles, coming soon"

function absoluteUrl(path: string, baseUrl: string) {
  return new URL(path, baseUrl).toString()
}

export function getComingSoonCanonicalUrl(baseUrl = getBaseURL()) {
  return absoluteUrl(COMING_SOON_PATH, baseUrl)
}

export function createComingSoonMetadata(baseUrl = getBaseURL()): Metadata {
  const canonical = getComingSoonCanonicalUrl(baseUrl)
  const socialImage = absoluteUrl(
    `${COMING_SOON_PATH}/opengraph-image`,
    baseUrl
  )

  return {
    title: COMING_SOON_TITLE,
    description: COMING_SOON_DESCRIPTION,
    alternates: {
      canonical,
    },
    robots: {
      index: true,
      follow: true,
    },
    openGraph: {
      type: "website",
      siteName: "Holo Trail TCG",
      locale: "en_GB",
      url: canonical,
      title: COMING_SOON_TITLE,
      description: COMING_SOON_DESCRIPTION,
      images: [
        {
          url: socialImage,
          width: 1200,
          height: 630,
          alt: COMING_SOON_SOCIAL_IMAGE_ALT,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: COMING_SOON_TITLE,
      description: COMING_SOON_DESCRIPTION,
      images: [
        {
          url: socialImage,
          alt: COMING_SOON_SOCIAL_IMAGE_ALT,
        },
      ],
    },
  }
}
