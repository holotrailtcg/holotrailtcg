import { MedusaError } from "@medusajs/framework/utils"
import { CARD_CONDITION, CONDITION_SOURCE, type CardCondition, type ConditionSource } from "../types"

const VALUES: Record<string, CardCondition> = {
  NM: CARD_CONDITION.NEAR_MINT, "NEAR MINT": CARD_CONDITION.NEAR_MINT, NEAR_MINT: CARD_CONDITION.NEAR_MINT,
  LP: CARD_CONDITION.LIGHTLY_PLAYED, "LIGHTLY PLAYED": CARD_CONDITION.LIGHTLY_PLAYED, LIGHTLY_PLAYED: CARD_CONDITION.LIGHTLY_PLAYED,
  MP: CARD_CONDITION.MODERATELY_PLAYED, "MODERATELY PLAYED": CARD_CONDITION.MODERATELY_PLAYED, MODERATELY_PLAYED: CARD_CONDITION.MODERATELY_PLAYED,
  HP: CARD_CONDITION.HEAVILY_PLAYED, "HEAVILY PLAYED": CARD_CONDITION.HEAVILY_PLAYED, HEAVILY_PLAYED: CARD_CONDITION.HEAVILY_PLAYED,
  DM: CARD_CONDITION.DAMAGED, DAMAGED: CARD_CONDITION.DAMAGED,
}

export interface ConditionResolution { condition: CardCondition; source: ConditionSource }

export function resolveCondition(raw?: string | null, productId?: string | null): ConditionResolution {
  const suffix = productId?.match(/\|([^|]+)$/)?.[1]
  const candidate = raw?.trim() || (suffix && suffix.toLowerCase() !== "null" ? suffix : undefined)
  if (!candidate) return { condition: CARD_CONDITION.NEAR_MINT, source: CONDITION_SOURCE.DEFAULTED }
  const condition = VALUES[candidate.normalize("NFC").trim().toUpperCase()]
  if (!condition) throw new MedusaError(MedusaError.Types.INVALID_DATA, `Unsupported card condition: ${candidate}`)
  return { condition, source: CONDITION_SOURCE.EXPLICIT }
}
