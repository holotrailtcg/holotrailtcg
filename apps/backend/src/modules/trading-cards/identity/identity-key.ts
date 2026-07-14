import type { CardCondition, CardFinish, SpecialTreatment } from "../types"
import { cardNumberForms } from "./card-number"

export function canonicalIdentityKey(cardSetId: string, cardNumber: string): string {
  return `${cardSetId}\u001f${cardNumberForms(cardNumber).normalised}`
}

export function variantIdentityKey(input: {
  tradingCardId: string
  condition: CardCondition
  finish: CardFinish
  specialTreatment: SpecialTreatment
}): string {
  return [input.tradingCardId, input.condition, input.finish, input.specialTreatment].join("\u001f")
}
