import { INVENTORY_CARD_CONDITION as CARD_CONDITION, INVENTORY_CONDITION_SOURCE } from "../types"
import type { ConditionResolution } from "./types"

/**
 * Maps a trusted Pulse condition token (from the `Condition` column, or the
 * `Product ID` field for older exports without it — see row-parser.ts) to
 * Stage 3's `CardCondition` enum. Only the four tokens Pulse actually emits
 * are recognised — no "dmg"/"dm" token exists in Pulse's export, so it is
 * not mapped here; "Damaged" remains a valid condition elsewhere in the
 * domain, it just never arrives via Pulse. Stage 3 has no "Mint" value
 * (only Near Mint and below), so a literal "mint" token is deliberately
 * treated as unrecognised rather than silently folded into Near Mint —
 * never inventing a mapping the domain doesn't support.
 */
const CONDITION_TOKEN_MAP: Record<string, string> = {
  nm: CARD_CONDITION.NEAR_MINT,
  lp: CARD_CONDITION.LIGHTLY_PLAYED,
  mp: CARD_CONDITION.MODERATELY_PLAYED,
  hp: CARD_CONDITION.HEAVILY_PLAYED,
}

export function resolveCondition(conditionToken: string | null): ConditionResolution {
  if (!conditionToken) {
    return { condition: CARD_CONDITION.NEAR_MINT, source: INVENTORY_CONDITION_SOURCE.DEFAULTED, unknownToken: null }
  }
  const mapped = CONDITION_TOKEN_MAP[conditionToken.toLowerCase()]
  if (!mapped) {
    return { condition: CARD_CONDITION.NEAR_MINT, source: INVENTORY_CONDITION_SOURCE.DEFAULTED, unknownToken: conditionToken }
  }
  return { condition: mapped, source: INVENTORY_CONDITION_SOURCE.EXPLICIT, unknownToken: null }
}
