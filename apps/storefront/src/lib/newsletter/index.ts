import { devNewsletterAdapter } from "./dev-adapter"
import type { NewsletterAdapter } from "./types"

export * from "./types"
export * from "./validation"

/**
 * The active newsletter adapter. This is the single swap point for Stage 2C:
 * replace `devNewsletterAdapter` with the real API adapter here (or select by
 * environment) and the form UI is unaffected.
 */
export const newsletterAdapter: NewsletterAdapter = devNewsletterAdapter
