import type { CardFinish, CardCondition, SpecialTreatment } from "../types"

export const PROTECTED_ENRICHMENT_FIELDS = [
  "condition", "conditionSource", "language", "finish", "specialTreatment", "sku", "stock",
  "acquisitionCost", "sellingPrice", "priceLocked", "realListingPhotographs", "publicationState", "manualProviderMatch",
] as const

export type ProtectedEnrichmentField = (typeof PROTECTED_ENRICHMENT_FIELDS)[number]

export type EnrichmentProposal = {
  name?: string
  rarity?: string
  illustrator?: string
  referenceArtworkUrl?: string
  pokedexNumbers?: number[]
  types?: string[]
  // Commercial fields are intentionally not part of this DTO.
}

export type ProtectedCommercialFields = {
  condition: CardCondition
  conditionSource: string
  language: string
  finish: CardFinish
  specialTreatment: SpecialTreatment
  sku: string
  stock: number
  acquisitionCost?: number
  sellingPrice?: number
  priceLocked: boolean
  realListingPhotographs: readonly string[]
  publicationState: string
  manualProviderMatch: boolean
}
