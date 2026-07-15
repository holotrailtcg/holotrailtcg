import { describe, expect, it } from "vitest"

import {
  COMING_SOON_DESCRIPTION,
  COMING_SOON_SOCIAL_IMAGE_ALT,
  COMING_SOON_TITLE,
  createComingSoonMetadata,
} from "./coming-soon"

describe("coming-soon metadata", () => {
  const baseUrl = "https://www.holotrailtcg.example/"
  const canonical = "https://www.holotrailtcg.example/gb/coming-soon"

  it("uses the absolute preferred canonical and indexable robots directives", () => {
    const metadata = createComingSoonMetadata(baseUrl)

    expect(metadata.title).toBe(COMING_SOON_TITLE)
    expect(metadata.description).toBe(COMING_SOON_DESCRIPTION)
    expect(metadata.alternates).toEqual({ canonical })
    expect(metadata.robots).toEqual({ index: true, follow: true })
  })

  it("provides matching Open Graph and Twitter large-image data", () => {
    const metadata = createComingSoonMetadata(baseUrl)
    const socialImage = `${canonical}/opengraph-image`

    expect(metadata.openGraph).toMatchObject({
      type: "website",
      siteName: "Holo Trail TCG",
      title: COMING_SOON_TITLE,
      description: COMING_SOON_DESCRIPTION,
      url: canonical,
      images: [
        {
          url: socialImage,
          width: 1200,
          height: 630,
          alt: COMING_SOON_SOCIAL_IMAGE_ALT,
        },
      ],
    })
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: COMING_SOON_TITLE,
      description: COMING_SOON_DESCRIPTION,
      images: [
        {
          url: socialImage,
          alt: COMING_SOON_SOCIAL_IMAGE_ALT,
        },
      ],
    })
  })
})
