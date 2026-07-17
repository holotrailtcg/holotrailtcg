import { INVENTORY_RARITY as RARITY } from "../types"
import type { RarityCandidate } from "./types"

/**
 * Deliberately conservative: only rarity strings with an unambiguous
 * Stage 3 equivalent are mapped. Pokémon-specific eBay rarity labels
 * observed in real Pulse exports (e.g. "Holo Rare V", "Holo Rare VSTAR")
 * have no safe 1:1 Stage 3 rarity and are left unmapped rather than guessed
 * — they, `Unknown`, blank, and any other unrecognised value all stay
 * pending review with the raw string preserved for an Admin to resolve.
 */
const RARITY_MAP: Record<string, string> = {
  "common": RARITY.COMMON,
  "uncommon": RARITY.UNCOMMON,
  "double rare": RARITY.DOUBLE_RARE,
  "ultra rare": RARITY.ULTRA_RARE,
  "ace spec": RARITY.ACE_SPEC,
  "promo": RARITY.PROMO,
  "no rarity": RARITY.NO_RARITY,
}

const RARITY_MAX_LENGTH = 128

export function mapRarity(rawRarity: string | null | undefined): RarityCandidate {
  const trimmed = (rawRarity ?? "").trim().slice(0, RARITY_MAX_LENGTH)
  if (!trimmed) return { candidate: null, raw: null }
  const lower = trimmed.toLowerCase()
  const withoutParenthetical = lower.replace(/\s*\([^)]*\)\s*$/, "").trim()
  const mapped = RARITY_MAP[lower] ?? RARITY_MAP[withoutParenthetical]
  return { candidate: mapped ?? null, raw: trimmed }
}
