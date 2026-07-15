export type ReviewStatus = "PENDING" | "APPROVED" | "REJECTED" | "APPLIED" | "SUPERSEDED"

export type AttemptOutcome =
  | "NO_MATCH"
  | "UNRESOLVED_SET"
  | "IDENTITY_MISMATCH"
  | "INVALID_LOCAL_IDENTITY"
  | "PROVIDER_ERROR"

export type MatchSource = "AUTOMATIC" | "MANUAL"

export interface ReviewListItem {
  id: string
  trading_card: { id: string; name: string; card_number: string }
  card_set: { id: string; display_name: string; provider_set_code: string; language: string }
  provider_card_id: string
  provider_set_id: string
  review_status: ReviewStatus
  match_source: MatchSource
  created_at: string
  updated_at: string
  reviewed_at: string | null
  applied_at: string | null
}

export interface ReviewListResponse {
  reviews: ReviewListItem[]
  count: number
  limit: number
  offset: number
}

export interface AttemptListItem {
  id: string
  trading_card: { id: string; name: string; card_number: string }
  card_set: { id: string; display_name: string; provider_set_code: string; language: string }
  outcome: AttemptOutcome
  match_source: MatchSource
  provider_card_id: string | null
  provider_set_id: string | null
  safe_provider_error_code: string | null
  created_at: string
  updated_at: string
}

export interface AttemptListResponse {
  attempts: AttemptListItem[]
  count: number
  limit: number
  offset: number
}

export interface EnrichmentSnapshotVariants {
  normal: boolean
  reverse: boolean
  holo: boolean
  firstEdition: boolean
}

export type RarityCandidate =
  | { status: "MAPPED"; providerValue: string; rarity: string; iconKey: string }
  | { status: "UNMAPPED"; providerValue: string }

export interface EnrichmentSnapshot {
  provider: "TCGDEX"
  providerCardId: string
  providerSetId: string
  name: string
  localId: string
  category: string
  referenceArtworkUrl?: string
  illustrator?: string
  providerRarity?: string
  rarityCandidate?: RarityCandidate
  pokedexNumbers?: number[]
  types?: string[]
  variants: EnrichmentSnapshotVariants
}

export interface ReviewAuditEntry {
  id: string
  actor: string
  action: string
  source: string
  created_at: string
}

export interface ReviewDetail {
  proposal: { id: string; provider: "TCGDEX"; provider_card_id: string; provider_set_id: string }
  trading_card: {
    id: string
    name: string
    card_number: string
    search_name: string
    rarity_raw: string | null
    rarity: string | null
  }
  card_set: {
    id: string
    display_name: string
    provider_set_code: string
    language: string
    game: string
    release_date: string | null
  }
  snapshot: EnrichmentSnapshot
  review_status: ReviewStatus
  match_source: MatchSource
  reviewer_id: string | null
  created_at: string
  updated_at: string
  reviewed_at: string | null
  applied_at: string | null
  audit_history: ReviewAuditEntry[]
}

export interface ReviewDetailResponse {
  review: ReviewDetail
}

export type RetryOutcome =
  | "MATCHED"
  | "NO_MATCH"
  | "UNRESOLVED_SET"
  | "IDENTITY_MISMATCH"
  | "INVALID_LOCAL_IDENTITY"
  | "PROVIDER_ERROR"

export interface RetryResponse {
  outcome: RetryOutcome
  review?: ReviewDetail
  attempt?: AttemptListItem
}
