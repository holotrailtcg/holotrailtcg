import { apiNewsletterAdapter } from "./api-adapter"
import type { NewsletterAdapter } from "./types"

export * from "./types"
export * from "./validation"
export * from "./submission"

/**
 * The active newsletter adapter. Keeping this single seam makes the form easy
 * to test without allowing provider or backend details into the UI.
 */
export const newsletterAdapter: NewsletterAdapter = apiNewsletterAdapter
