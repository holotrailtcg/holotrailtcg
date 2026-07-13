import {
  CONSENT_VERSION,
  DEFAULT_CONSENT,
  type ConsentState,
} from "./types"

/**
 * Pure, SSR-safe helpers for reading/writing the consent decision. The parse
 * and serialize functions take/return strings so they can be unit tested with
 * no browser. `readConsent`/`writeConsent` guard `window` for SSR.
 */

export const CONSENT_STORAGE_KEY = "ht_consent"

/** Parse a stored value into a ConsentState, falling back to the safe default. */
export function parseConsent(raw: string | null | undefined): ConsentState {
  if (!raw) return DEFAULT_CONSENT

  try {
    const parsed = JSON.parse(raw) as Partial<ConsentState>

    // A decision from an older category set must re-prompt (analytics stays off).
    if (parsed.version !== CONSENT_VERSION) {
      return DEFAULT_CONSENT
    }

    const analytics = Boolean(parsed.categories?.analytics)

    return {
      categories: { essential: true, analytics },
      decided: Boolean(parsed.decided),
      decidedAt: parsed.decidedAt,
      version: CONSENT_VERSION,
    }
  } catch {
    // Malformed value: never fail, never silently enable analytics.
    return DEFAULT_CONSENT
  }
}

export function serializeConsent(state: ConsentState): string {
  return JSON.stringify(state)
}

/** Build a decided state for the given analytics choice. */
export function decideConsent(analytics: boolean): ConsentState {
  return {
    categories: { essential: true, analytics },
    decided: true,
    decidedAt: new Date().toISOString(),
    version: CONSENT_VERSION,
  }
}

export function readConsent(): ConsentState {
  if (typeof window === "undefined") return DEFAULT_CONSENT
  try {
    return parseConsent(window.localStorage.getItem(CONSENT_STORAGE_KEY))
  } catch {
    return DEFAULT_CONSENT
  }
}

export function writeConsent(state: ConsentState): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, serializeConsent(state))
  } catch {
    // Storage may be unavailable (private mode, blocked). Fail quietly; the
    // in-memory state still drives the UI for this session.
  }
}
