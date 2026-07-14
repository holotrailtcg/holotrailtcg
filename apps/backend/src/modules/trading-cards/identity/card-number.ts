export interface CardNumberForms {
  original: string
  normalised: string
}

export function normaliseComparisonText(value: string): string {
  return value.normalize("NFC").trim()
}

export function cardNumberForms(value: string): CardNumberForms {
  if (typeof value !== "string") {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Card number must be a string")
  }
  const normalised = normaliseComparisonText(value)
  if (!normalised) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Card number must not be empty")
  }
  return { original: value, normalised }
}
import { MedusaError } from "@medusajs/framework/utils"
