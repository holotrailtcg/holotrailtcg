import { MedusaError } from "@medusajs/framework/utils"
import { CARD_LANGUAGE, type CardLanguage } from "../types"

export function normaliseLanguage(value: string): CardLanguage {
  const language = value.normalize("NFC").trim().toUpperCase()
  if (Object.values(CARD_LANGUAGE).includes(language as CardLanguage)) {
    return language as CardLanguage
  }
  throw new MedusaError(MedusaError.Types.INVALID_DATA, `Unsupported card language: ${value}`)
}
