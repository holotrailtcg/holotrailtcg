/**
 * Cookie-consent state abstraction.
 *
 * This stage builds the consent UI only — it does NOT load Google Analytics.
 * The state shape below is what Stage 2E will read to decide whether to enable
 * GA4. There is no marketing category because no marketing cookies are used.
 */

/** Bump when the consent categories change so old stored decisions re-prompt. */
export const CONSENT_VERSION = 1

export type ConsentCategories = {
  /** Always true — strictly necessary cookies cannot be switched off. */
  essential: true
  /** Analytics (GA4). Rejected by default. */
  analytics: boolean
}

export type ConsentState = {
  categories: ConsentCategories
  /** True once the visitor has made an explicit accept/reject choice. */
  decided: boolean
  /** ISO timestamp of the decision, if any. */
  decidedAt?: string
  version: number
}

/** Default state: analytics rejected, no decision made yet. */
export const DEFAULT_CONSENT: ConsentState = {
  categories: { essential: true, analytics: false },
  decided: false,
  version: CONSENT_VERSION,
}
