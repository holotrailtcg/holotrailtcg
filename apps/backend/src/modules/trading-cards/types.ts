export const CARD_GAME = { POKEMON: "POKEMON" } as const
export type CardGame = (typeof CARD_GAME)[keyof typeof CARD_GAME]

export const CARD_LANGUAGE = { EN: "EN", JA: "JA", ZH: "ZH" } as const
export type CardLanguage = (typeof CARD_LANGUAGE)[keyof typeof CARD_LANGUAGE]

/** Display label for each `CardLanguage` — used when generating human-readable product copy (see create-card-from-inventory-row.ts). */
export const CARD_LANGUAGE_LABELS: Record<CardLanguage, string> = {
  EN: "English",
  JA: "Japanese",
  ZH: "Chinese",
}

export const RECORD_ORIGIN = {
  MANUAL: "MANUAL",
  TCGDEX: "TCGDEX",
  PULSE: "PULSE",
  OTHER: "OTHER",
} as const
export type RecordOrigin = (typeof RECORD_ORIGIN)[keyof typeof RECORD_ORIGIN]

export const CARD_CONDITION = {
  NEAR_MINT: "NEAR_MINT",
  LIGHTLY_PLAYED: "LIGHTLY_PLAYED",
  MODERATELY_PLAYED: "MODERATELY_PLAYED",
  HEAVILY_PLAYED: "HEAVILY_PLAYED",
  DAMAGED: "DAMAGED",
} as const
export type CardCondition = (typeof CARD_CONDITION)[keyof typeof CARD_CONDITION]

/** Display label for each `CardCondition` — the single source of truth for anywhere a condition is shown to a human, including the Medusa "Condition" product option (see create-card-from-inventory-row.ts). */
export const CARD_CONDITION_LABELS: Record<CardCondition, string> = {
  NEAR_MINT: "Near Mint",
  LIGHTLY_PLAYED: "Lightly Played",
  MODERATELY_PLAYED: "Moderately Played",
  HEAVILY_PLAYED: "Heavily Played",
  DAMAGED: "Damaged",
}

export const CONDITION_SOURCE = { EXPLICIT: "EXPLICIT", DEFAULTED: "DEFAULTED" } as const
export type ConditionSource = (typeof CONDITION_SOURCE)[keyof typeof CONDITION_SOURCE]

export const CARD_FINISH = {
  NORMAL: "NORMAL",
  HOLO: "HOLO",
  REVERSE_HOLO: "REVERSE_HOLO",
  OTHER: "OTHER",
} as const
export type CardFinish = (typeof CARD_FINISH)[keyof typeof CARD_FINISH]

/** Display label for each `CardFinish` — the single source of truth for anywhere a finish is shown to a human, including the Medusa "Finish" product option. */
export const CARD_FINISH_LABELS: Record<CardFinish, string> = {
  NORMAL: "Normal",
  HOLO: "Holo",
  REVERSE_HOLO: "Reverse Holo",
  OTHER: "Other",
}

export const SPECIAL_TREATMENT = {
  NONE: "NONE",
  ENERGY_REVERSE: "ENERGY_REVERSE",
  POKE_BALL_REVERSE: "POKE_BALL_REVERSE",
  MASTER_BALL_REVERSE: "MASTER_BALL_REVERSE",
  LOVE_BALL_REVERSE: "LOVE_BALL_REVERSE",
  QUICK_BALL_REVERSE: "QUICK_BALL_REVERSE",
  FRIEND_BALL_REVERSE: "FRIEND_BALL_REVERSE",
  DUSK_BALL_REVERSE: "DUSK_BALL_REVERSE",
  ROCKET_REVERSE: "ROCKET_REVERSE",
  POKE_BALL: "POKE_BALL",
  MASTER_BALL: "MASTER_BALL",
  STARLIGHT_HOLO: "STARLIGHT_HOLO",
  COSMOS_HOLO: "COSMOS_HOLO",
  TINSEL_HOLO: "TINSEL_HOLO",
  GALAXY_HOLO: "GALAXY_HOLO",
  CRACKED_ICE: "CRACKED_ICE",
  STAMPED: "STAMPED",
  PRERELEASE_STAMPED: "PRERELEASE_STAMPED",
  PROMOTIONAL_STAMPED: "PROMOTIONAL_STAMPED",
  TEXTURED: "TEXTURED",
  ETCHED: "ETCHED",
  OTHER: "OTHER",
} as const
export type SpecialTreatment = (typeof SPECIAL_TREATMENT)[keyof typeof SPECIAL_TREATMENT]

/**
 * Display label for each `SpecialTreatment` — the single source of truth
 * for anywhere a special treatment is shown to a human, including the
 * Medusa "Special Treatment" product option. Built from real Pulse
 * `material` strings observed in `pulse/material-mapping.ts` — neither
 * TCGdex nor Pulse's own API has a dedicated special-treatment field to
 * source this from instead (confirmed against both before choosing this).
 */
export const SPECIAL_TREATMENT_LABELS: Record<SpecialTreatment, string> = {
  NONE: "None",
  ENERGY_REVERSE: "Energy Reverse",
  POKE_BALL_REVERSE: "Poké Ball Reverse",
  MASTER_BALL_REVERSE: "Master Ball Reverse",
  LOVE_BALL_REVERSE: "Love Ball Reverse",
  QUICK_BALL_REVERSE: "Quick Ball Reverse",
  FRIEND_BALL_REVERSE: "Friend Ball Reverse",
  DUSK_BALL_REVERSE: "Dusk Ball Reverse",
  ROCKET_REVERSE: "Rocket Reverse",
  POKE_BALL: "Poké Ball",
  MASTER_BALL: "Master Ball",
  STARLIGHT_HOLO: "Starlight Holo",
  COSMOS_HOLO: "Cosmos Holo",
  TINSEL_HOLO: "Tinsel Holo",
  GALAXY_HOLO: "Galaxy Holo",
  CRACKED_ICE: "Cracked Ice",
  STAMPED: "Stamped",
  PRERELEASE_STAMPED: "Prerelease Stamped",
  PROMOTIONAL_STAMPED: "Promotional Stamped",
  TEXTURED: "Textured",
  ETCHED: "Etched",
  OTHER: "Other",
}

export const RARITY = {
  ACE_SPEC: "ACE_SPEC",
  BLACK_WHITE_RARE: "BLACK_WHITE_RARE",
  COMMON: "COMMON",
  DOUBLE_RARE: "DOUBLE_RARE",
  HYPER_RARE: "HYPER_RARE",
  ILLUSTRATION_RARE: "ILLUSTRATION_RARE",
  MEGA_ATTACK_RARE: "MEGA_ATTACK_RARE",
  MEGA_HYPER_RARE: "MEGA_HYPER_RARE",
  NO_RARITY: "NO_RARITY",
  PROMO: "PROMO",
  SHINY_ULTRA_RARE: "SHINY_ULTRA_RARE",
  ULTRA_RARE_SINGLE: "ULTRA_RARE_SINGLE",
  ULTRA_RARE: "ULTRA_RARE",
  UNCOMMON: "UNCOMMON",
} as const
export type Rarity = (typeof RARITY)[keyof typeof RARITY]

export const RARITY_ICON_KEY = {
  ACE_SPEC: "ace-spec",
  BLACK_WHITE_RARE: "black-white-rare",
  COMMON: "common",
  DOUBLE_RARE: "double-rare",
  HYPER_RARE: "hyper-rare",
  ILLUSTRATION_RARE: "illustration-rare",
  MEGA_ATTACK_RARE: "mega-attack-rare",
  MEGA_HYPER_RARE: "mega-hyper-rare",
  NO_RARITY: "no-rarity",
  PROMO: "promo",
  SHINY_ULTRA_RARE: "shiny-ultra-rare",
  ULTRA_RARE_SINGLE: "ultra-rare-single",
  ULTRA_RARE: "ultra-rare",
  UNCOMMON: "uncommon",
} as const
export type RarityIconKey = (typeof RARITY_ICON_KEY)[keyof typeof RARITY_ICON_KEY]

export const EXTERNAL_PROVIDER = {
  TCGDEX: "TCGDEX",
  PULSE: "PULSE",
  EBAY: "EBAY",
  OTHER: "OTHER",
} as const
export type ExternalProvider = (typeof EXTERNAL_PROVIDER)[keyof typeof EXTERNAL_PROVIDER]

export const EXTERNAL_REFERENCE_PROVENANCE = {
  AUTOMATIC: "AUTOMATIC",
  TRUSTED_MANUAL: "TRUSTED_MANUAL",
} as const
export type ExternalReferenceProvenance = (typeof EXTERNAL_REFERENCE_PROVENANCE)[keyof typeof EXTERNAL_REFERENCE_PROVENANCE]

export const AUDIT_ENTITY_TYPE = {
  TRADING_CARD: "TRADING_CARD",
  TRADING_CARD_VARIANT: "TRADING_CARD_VARIANT",
  EXTERNAL_CARD_REFERENCE: "EXTERNAL_CARD_REFERENCE",
  ENRICHMENT_PROPOSAL: "ENRICHMENT_PROPOSAL",
  CARD_IMAGE: "CARD_IMAGE",
} as const

export const AUDIT_ACTION = {
  CANONICAL_IDENTITY_CHANGED: "CANONICAL_IDENTITY_CHANGED",
  CONDITION_CHANGED: "CONDITION_CHANGED",
  FINISH_CHANGED: "FINISH_CHANGED",
  SPECIAL_TREATMENT_CHANGED: "SPECIAL_TREATMENT_CHANGED",
  PRICE_LOCKED: "PRICE_LOCKED",
  PRICE_UNLOCKED: "PRICE_UNLOCKED",
  EXTERNAL_REFERENCE_ADDED: "EXTERNAL_REFERENCE_ADDED",
  EXTERNAL_REFERENCE_CHANGED: "EXTERNAL_REFERENCE_CHANGED",
  EXTERNAL_REFERENCE_REMOVED: "EXTERNAL_REFERENCE_REMOVED",
  TCGDEX_ENRICHMENT_RECORDED: "TCGDEX_ENRICHMENT_RECORDED",
  TCGDEX_ENRICHMENT_SUPERSEDED: "TCGDEX_ENRICHMENT_SUPERSEDED",
  TCGDEX_ENRICHMENT_APPROVED: "TCGDEX_ENRICHMENT_APPROVED",
  TCGDEX_ENRICHMENT_REJECTED: "TCGDEX_ENRICHMENT_REJECTED",
  TCGDEX_ENRICHMENT_APPLIED: "TCGDEX_ENRICHMENT_APPLIED",
  TCGDEX_MANUAL_REFERENCE_RECORDED: "TCGDEX_MANUAL_REFERENCE_RECORDED",
  IMAGE_UPLOAD_REQUESTED: "IMAGE_UPLOAD_REQUESTED",
  IMAGE_UPLOAD_CONFIRMED: "IMAGE_UPLOAD_CONFIRMED",
  IMAGE_UPLOAD_REJECTED: "IMAGE_UPLOAD_REJECTED",
  IMAGE_UPLOAD_EXPIRED: "IMAGE_UPLOAD_EXPIRED",
  IMAGE_DUPLICATE_DETECTED: "IMAGE_DUPLICATE_DETECTED",
  IMAGE_REORDERED: "IMAGE_REORDERED",
  IMAGE_FOCAL_CHANGED: "IMAGE_FOCAL_CHANGED",
  IMAGE_ARCHIVED: "IMAGE_ARCHIVED",
  IMAGE_RESTORED: "IMAGE_RESTORED",
} as const

/**
 * Stage 4B.1 lifecycle. PENDING images have no confirmed bytes yet;
 * READY images are active and reusable; DUPLICATE/REJECTED/EXPIRED are
 * terminal non-active outcomes of the (not yet built) confirmation step;
 * ARCHIVED is the only lifecycle exit from READY and is always reversible.
 */
export const IMAGE_STATUS = {
  PENDING: "PENDING",
  READY: "READY",
  DUPLICATE: "DUPLICATE",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
  ARCHIVED: "ARCHIVED",
} as const
export type ImageStatus = (typeof IMAGE_STATUS)[keyof typeof IMAGE_STATUS]

export const SUPPORTED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const
export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number]

/** Stage 4B.2: the only project-wide limit on an uploaded card image's declared or actual byte size. */
export const MAX_CARD_IMAGE_BYTE_SIZE = 10 * 1024 * 1024

/** Stage 4B.2: how long a presigned upload URL, and the PENDING row it belongs to, remain valid. Checked lazily at confirm time, and (Stage 4B.4) also swept hourly by the `card-image-expiry-sweep` job. */
export const CARD_IMAGE_UPLOAD_EXPIRY_MINUTES = 15

/** Stage 4B.4: the audit-entry `actor` recorded for card-image mutations made by a background cleanup job rather than an authenticated Admin user. */
export const CARD_IMAGE_CLEANUP_ACTOR = "system:card-image-cleanup"

/** Stage 4B.4 Slice 2: an R2 object under a managed prefix younger than this is never treated as an orphan candidate, regardless of reference state — it may simply be mid-upload. */
export const CARD_IMAGE_ORPHAN_GRACE_PERIOD_MINUTES = 30

/** Stage 4B.4 Slice 2: the bounded maximum number of R2 objects a single reconciliation run inspects for one managed prefix; a larger backlog is drained across successive scheduled runs, never in one pass. */
export const CARD_IMAGE_ORPHAN_MAX_OBJECTS_PER_RUN = 5000

/** Stage 4B.4 Slice 2: the fixed `pg_advisory_lock` namespace (first int of the two-int form) reserved for orphan-reconciliation prefix locks — arbitrary but stable, chosen once and never reused for another lock domain. */
export const CARD_IMAGE_ORPHAN_LOCK_NAMESPACE = 424242
