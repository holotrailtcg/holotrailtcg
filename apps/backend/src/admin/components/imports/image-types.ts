export type CardLanguage = "EN" | "JA" | "ZH"

export type ImageNeedStatus = "MISSING" | "PARTIAL" | "READY"

export type CardImageStatus = "PENDING" | "READY" | "DUPLICATE" | "REJECTED" | "EXPIRED" | "ARCHIVED"

export interface ImageListItem {
  trading_card_id: string
  card_name: string
  card_number: string
  card_set: { id: string; display_name: string; language: CardLanguage }
  total_variant_count: number
  variants_missing_images: number
  ready_image_count: number
  need_status: ImageNeedStatus
}

export interface ImageListResponse {
  cards: ImageListItem[]
  count: number
  limit: number
  offset: number
}

/** Mirrors `toSafeCardImageDto`'s exact output shape on the backend. */
export interface CardImageDto {
  id: string
  status: CardImageStatus
  tradingCardVariantId: string
  originalFilename: string
  confirmedMimeType: string | null
  width: number | null
  height: number | null
  sortOrder: number
  focalX: number
  focalY: number
  imageUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface VariantImageGroup {
  id: string
  sku: string
  condition: string
  finish: string
  special_treatment: string
  ready_images: CardImageDto[]
  archived_images: CardImageDto[]
}

export interface CardImageDetail {
  trading_card: { id: string; name: string; card_number: string }
  card_set: { id: string; display_name: string; language: CardLanguage }
  tcgdex_reference_artwork_url: string | null
  variants: VariantImageGroup[]
}

export interface BeginUploadResponse {
  uploadUrl: string
  objectKey: string
  imageId: string
  expiresAt: string
  requiredHeaders: Record<string, string>
}
