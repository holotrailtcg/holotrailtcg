import { INVENTORY_CARD_CONDITION as CARD_CONDITION, INVENTORY_CONDITION_SOURCE } from "../types"
import type { ConditionResolution } from "./types"

/**
 * Maps a trusted Product-ID condition token to Stage 3's `CardCondition`
 * enum. Stage 3 has no "Mint" value (only Near Mint and below), so a
 * literal "mint" token is deliberately treated as unrecognised rather than
 * silently folded into Near Mint — never inventing a mapping the domain
 * doesn't support.
 */
const CONDITION_TOKEN_MAP: Record<string, string> = {
  nm: CARD_CONDITION.NEAR_MINT,
  lp: CARD_CONDITION.LIGHTLY_PLAYED,
  mp: CARD_CONDITION.MODERATELY_PLAYED,
  hp: CARD_CONDITION.HEAVILY_PLAYED,
  dmg: CARD_CONDITION.DAMAGED,
  dm: CARD_CONDITION.DAMAGED,
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
