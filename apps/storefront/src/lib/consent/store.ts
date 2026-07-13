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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** True only for a string that is a valid, ISO-8601 round-trippable timestamp. */
function isValidIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false
  const time = Date.parse(value)
  if (Number.isNaN(time)) return false
  // Reject loosely-parseable strings (e.g. "2020") by requiring a round trip.
  return new Date(time).toISOString() === value
}

/**
 * Parse a stored value into a ConsentState, falling back to the safe default.
 *
 * Validation is strict and fails closed: any missing, corrupt, malformed or
 * wrongly typed field returns DEFAULT_CONSENT (analytics rejected). Type
 * coercion is deliberately avoided so a truthy string like `"false"` can never
 * be read as an analytics approval.
 */
export function parseConsent(raw: string | null | undefined): ConsentState {
  if (!raw) return DEFAULT_CONSENT

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Malformed JSON: never fail, never silently enable analytics.
    return DEFAULT_CONSENT
  }

  if (!isPlainObject(parsed)) return DEFAULT_CONSENT

  // Accept only the exact supported version (a number, not "1").
  if (parsed.version !== CONSENT_VERSION) return DEFAULT_CONSENT

  const { categories, decided, decidedAt } = parsed

  if (!isPlainObject(categories)) return DEFAULT_CONSENT
  // essential must be exactly true; analytics must be an actual boolean.
  if (categories.essential !== true) return DEFAULT_CONSENT
  if (typeof categories.analytics !== "boolean") return DEFAULT_CONSENT
  if (typeof decided !== "boolean") return DEFAULT_CONSENT
  // decidedAt is optional, but if present it must be a valid ISO timestamp.
  if (decidedAt !== undefined && !isValidIsoTimestamp(decidedAt)) {
    return DEFAULT_CONSENT
  }

  return {
    categories: { essential: true, analytics: categories.analytics },
    decided,
    ...(decidedAt !== undefined ? { decidedAt } : {}),
    version: CONSENT_VERSION,
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
