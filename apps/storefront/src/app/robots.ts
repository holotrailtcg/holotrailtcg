import type { MetadataRoute } from "next"

import { getBaseURL } from "@lib/util/env"

export function createRobots(baseUrl: string): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/checkout",
        "/*/checkout",
        "/account",
        "/*/account",
        "/newsletter/confirm",
        "/*/newsletter/confirm",
        "/newsletter/unsubscribe",
        "/*/newsletter/unsubscribe",
      ],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  }
}

export default function robots(): MetadataRoute.Robots {
  return createRobots(getBaseURL())
}
