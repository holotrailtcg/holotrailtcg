import type { CardFinish, CardCondition, SpecialTreatment } from "../types"
import type { CardEnrichmentData } from "./matching-types"

export const PROTECTED_ENRICHMENT_FIELDS = [
  "condition", "conditionSource", "language", "finish", "specialTreatment", "sku", "stock", "quantity",
  "acquisitionCost", "sellingPrice", "priceLocked", "realListingPhotographs", "publicationState", "manualProviderMatch",
] as const

export type ProtectedEnrichmentField = (typeof PROTECTED_ENRICHMENT_FIELDS)[number]

export type EnrichmentProposal = CardEnrichmentData

export type ProtectedCommercialFields = {
  condition: CardCondition
  conditionSource: string
  language: string
  finish: CardFinish
  specialTreatment: SpecialTreatment
  sku: string
  stock: number
  quantity: number
  acquisitionCost?: number
  sellingPrice?: number
  priceLocked: boolean
  realListingPhotographs: readonly string[]
  publicationState: string
  manualProviderMatch: boolean
}
