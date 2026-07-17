import { INVENTORY_SOURCE_LANGUAGE } from "../types"
import type { LanguageResolution } from "./types"

/** Provider-reference hint suffixes observed in real Pulse Product IDs; diagnostic-only, never authoritative on their own. */
const PROVIDER_HINT_SUFFIXES: Array<{ suffix: string; language: string }> = [
  { suffix: "_jp", language: INVENTORY_SOURCE_LANGUAGE.JA },
  { suffix: "_scn", language: INVENTORY_SOURCE_LANGUAGE.ZH },
]

export function inferProviderLanguageHint(setCodeCandidate: string | null): string | null {
  if (!setCodeCandidate) return null
  const lower = setCodeCandidate.toLowerCase()
  return PROVIDER_HINT_SUFFIXES.find(({ suffix }) => lower.endsWith(suffix))?.language ?? null
}

/**
 * The selected inventory source is always the language authority — a
 * provider hint is a consistency check only. A source with no fixed
 * language falls back to the hint (still non-authoritative, just the only
 * signal available); disagreement between an explicit source language and a
 * present hint is flagged, never silently overridden either way.
 */
export function resolveRowLanguage(sourceLanguage: string | null, hint: string | null): LanguageResolution {
  if (sourceLanguage) {
    return { language: sourceLanguage, conflict: hint !== null && hint !== sourceLanguage, hint }
  }
  return { language: hint, conflict: false, hint }
}
