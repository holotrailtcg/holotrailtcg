import type { CardLanguage, Rarity, RarityIconKey } from "../types"

export const TCGDEX_MATCH_CODE = {
  MATCHED: "MATCHED",
  NO_MATCH: "NO_MATCH",
  UNRESOLVED_SET: "UNRESOLVED_SET",
  IDENTITY_MISMATCH: "IDENTITY_MISMATCH",
  INVALID_LOCAL_IDENTITY: "INVALID_LOCAL_IDENTITY",
  PROVIDER_ERROR: "PROVIDER_ERROR",
} as const
export type TcgDexMatchCode = (typeof TCGDEX_MATCH_CODE)[keyof typeof TCGDEX_MATCH_CODE]

export const TCGDEX_MATCH_SOURCE = { AUTOMATIC: "AUTOMATIC", MANUAL: "MANUAL" } as const
export type TcgDexMatchSource = (typeof TCGDEX_MATCH_SOURCE)[keyof typeof TCGDEX_MATCH_SOURCE]

export type TcgDexSetIdentity = {
  tcgdexSetId?: string
  externalReference?: { provider: "TCGDEX"; providerIdentifier: string }
}

export type TcgDexMatchInput = {
  language: CardLanguage
  setCode: string
  cardNumber: string
  cardName?: string
  setIdentity?: TcgDexSetIdentity
  manualCardReference?: { provider: "TCGDEX"; providerIdentifier: string }
}

export type NormalizedRarityCandidate =
  | { status: "MAPPED"; providerValue: string; rarity: Rarity; iconKey: RarityIconKey }
  | { status: "UNMAPPED"; providerValue: string }

export type NormalizedCardVariants = {
  normal: boolean
  reverse: boolean
  holo: boolean
  firstEdition: boolean
}

export type CardEnrichmentData = {
  provider: "TCGDEX"
  providerCardId: string
  providerSetId: string
  name: string
  localId: string
  category: string
  referenceArtworkUrl?: string
  illustrator?: string
  providerRarity?: string
  rarityCandidate?: NormalizedRarityCandidate
  pokedexNumbers?: number[]
  types?: string[]
  variants: NormalizedCardVariants
}

export type TcgDexMatchResult =
  | { code: "MATCHED"; source: TcgDexMatchSource; enrichment: CardEnrichmentData }
  | { code: "NO_MATCH"; source: TcgDexMatchSource; reason: "NOT_FOUND" }
  | { code: "UNRESOLVED_SET"; source: "AUTOMATIC"; setCode: string }
  | { code: "IDENTITY_MISMATCH"; source: TcgDexMatchSource; expected: { setId?: string; localId: string }; actual: { setId: string; localId: string } }
  | { code: "INVALID_LOCAL_IDENTITY"; source: TcgDexMatchSource; field: "language" | "setCode" | "cardNumber" | "reference" }
  | { code: "PROVIDER_ERROR"; source: TcgDexMatchSource; providerCode: string; attemptCount: number }
