import type { CardLanguage } from "../types"

/**
 * Best-guess TCGdex set ids for a provider's own set code, derived from the
 * patterns confirmed against real Pulse exports: Japanese codes carry a
 * "_jp" suffix TCGdex doesn't use, and English "ME"/SWSH-era codes
 * sometimes spell a half-set as "pt5" where TCGdex uses ".5". Never
 * guaranteed correct — the caller must still verify against a live TCGdex
 * set list before treating any candidate as confirmed. Chinese codes have
 * no known derivable pattern, so only the literal code is offered.
 */
export function candidateTcgdexSetIds(providerSetCode: string, language: CardLanguage): string[] {
  const candidates = new Set<string>()
  const trimmed = providerSetCode.trim()
  if (!trimmed) return []
  candidates.add(trimmed)

  if (language === "JA" && /_jp$/i.test(trimmed)) {
    candidates.add(trimmed.replace(/_jp$/i, ""))
  }
  if (language === "EN" && /pt\d/i.test(trimmed)) {
    candidates.add(trimmed.replace(/pt(\d+)/gi, ".$1"))
  }
  return [...candidates]
}
