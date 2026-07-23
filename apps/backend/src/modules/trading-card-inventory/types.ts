export const INVENTORY_PROVIDER = { PULSE: "PULSE", OTHER: "OTHER" } as const
export type InventoryProvider = (typeof INVENTORY_PROVIDER)[keyof typeof INVENTORY_PROVIDER]

/** Reuses the Stage 3 `CardLanguage` value set; a source with no fixed language (e.g. a mixed-language eBay stock export) leaves this null. */
export const INVENTORY_SOURCE_LANGUAGE = { EN: "EN", JA: "JA", ZH: "ZH" } as const
export type InventorySourceLanguage = (typeof INVENTORY_SOURCE_LANGUAGE)[keyof typeof INVENTORY_SOURCE_LANGUAGE]

export const INVENTORY_SOURCE_STATUS = { ACTIVE: "ACTIVE", ARCHIVED: "ARCHIVED" } as const
export type InventorySourceStatus = (typeof INVENTORY_SOURCE_STATUS)[keyof typeof INVENTORY_SOURCE_STATUS]

/**
 * Stage 5A.1 snapshot lifecycle. No CSV parser exists yet, so nothing
 * automatically drives a snapshot through these states this stage — the
 * state machine and its guards are proven with directly-created rows.
 * DRAFT: created, not yet structurally validated.
 * VALIDATED: file structure/type confirmed sound (later stage's parser).
 * PENDING_REVIEW: row-level proposals generated and awaiting Admin review.
 * APPROVED: reviewer approved the proposed changes; not yet applied.
 * APPLYING: application to holdings/ledger in progress (transient).
 * APPLIED: terminal success; holdings/ledger reflect this snapshot.
 * REJECTED / FAILED / SUPERSEDED: terminal non-success outcomes.
 * DISCARDED: terminal — an Admin manually removed this snapshot from the
 * working list before it was ever applied. Reachable only from states where
 * nothing has touched real stock yet (see the transition table below); never
 * reachable from APPLIED/APPLYING, so a discard can never hide a snapshot
 * that already moved inventory.
 */
export const INVENTORY_SNAPSHOT_STATUS = {
  DRAFT: "DRAFT",
  VALIDATED: "VALIDATED",
  PENDING_REVIEW: "PENDING_REVIEW",
  APPROVED: "APPROVED",
  APPLYING: "APPLYING",
  APPLIED: "APPLIED",
  REJECTED: "REJECTED",
  FAILED: "FAILED",
  SUPERSEDED: "SUPERSEDED",
  DISCARDED: "DISCARDED",
} as const
export type InventorySnapshotStatus = (typeof INVENTORY_SNAPSHOT_STATUS)[keyof typeof INVENTORY_SNAPSHOT_STATUS]

/**
 * Explicit, validated snapshot transition table. Each key's array lists the
 * statuses a snapshot in that state may move to; anything else is rejected.
 */
export const INVENTORY_SNAPSHOT_STATUS_TRANSITIONS: Record<InventorySnapshotStatus, InventorySnapshotStatus[]> = {
  DRAFT: [INVENTORY_SNAPSHOT_STATUS.VALIDATED, INVENTORY_SNAPSHOT_STATUS.FAILED, INVENTORY_SNAPSHOT_STATUS.DISCARDED],
  VALIDATED: [
    INVENTORY_SNAPSHOT_STATUS.PENDING_REVIEW, INVENTORY_SNAPSHOT_STATUS.FAILED, INVENTORY_SNAPSHOT_STATUS.DISCARDED,
  ],
  PENDING_REVIEW: [
    INVENTORY_SNAPSHOT_STATUS.APPROVED,
    INVENTORY_SNAPSHOT_STATUS.REJECTED,
    INVENTORY_SNAPSHOT_STATUS.SUPERSEDED,
    INVENTORY_SNAPSHOT_STATUS.DISCARDED,
  ],
  APPROVED: [
    INVENTORY_SNAPSHOT_STATUS.APPLYING,
    INVENTORY_SNAPSHOT_STATUS.SUPERSEDED,
    INVENTORY_SNAPSHOT_STATUS.DISCARDED,
  ],
  APPLYING: [INVENTORY_SNAPSHOT_STATUS.APPLIED, INVENTORY_SNAPSHOT_STATUS.FAILED],
  APPLIED: [INVENTORY_SNAPSHOT_STATUS.SUPERSEDED],
  REJECTED: [INVENTORY_SNAPSHOT_STATUS.DISCARDED],
  FAILED: [INVENTORY_SNAPSHOT_STATUS.DISCARDED],
  SUPERSEDED: [],
  DISCARDED: [],
}

/**
 * Stage 5A.1 holding lifecycle — an explicit operational axis distinct from
 * publish readiness (which is always computed live). DRAFT is the initial
 * state; READY holdings count toward the publish-readiness approved-quantity
 * signal; ARCHIVED means "stop selling from this holding" without touching
 * its quantity, cost fields, or the transaction ledger, and is reversible.
 */
export const INVENTORY_HOLDING_STATUS = { DRAFT: "DRAFT", READY: "READY", ARCHIVED: "ARCHIVED" } as const
export type InventoryHoldingStatus = (typeof INVENTORY_HOLDING_STATUS)[keyof typeof INVENTORY_HOLDING_STATUS]

export const INVENTORY_HOLDING_STATUS_TRANSITIONS: Record<InventoryHoldingStatus, InventoryHoldingStatus[]> = {
  DRAFT: [INVENTORY_HOLDING_STATUS.READY, INVENTORY_HOLDING_STATUS.ARCHIVED],
  READY: [INVENTORY_HOLDING_STATUS.ARCHIVED],
  ARCHIVED: [INVENTORY_HOLDING_STATUS.READY],
}

/** Provider-neutral pre-resolution identifier kind carried by a draft proposal. */
export const INVENTORY_PROVIDER_REFERENCE_TYPE = {
  PULSE_PRODUCT_ID: "PULSE_PRODUCT_ID",
  SKU: "SKU",
  BARCODE: "BARCODE",
  OTHER: "OTHER",
} as const
export type InventoryProviderReferenceType =
  (typeof INVENTORY_PROVIDER_REFERENCE_TYPE)[keyof typeof INVENTORY_PROVIDER_REFERENCE_TYPE]

export const INVENTORY_PROPOSAL_CHANGE_KIND = {
  NEW_HOLDING: "NEW_HOLDING",
  QUANTITY_CHANGE: "QUANTITY_CHANGE",
  COST_CHANGE: "COST_CHANGE",
  PRICE_CHANGE: "PRICE_CHANGE",
  NO_CHANGE: "NO_CHANGE",
  UNRESOLVED_VARIANT: "UNRESOLVED_VARIANT",
} as const
export type InventoryProposalChangeKind =
  (typeof INVENTORY_PROPOSAL_CHANGE_KIND)[keyof typeof INVENTORY_PROPOSAL_CHANGE_KIND]

export const INVENTORY_PROPOSAL_REVIEW_STATUS = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  APPLIED: "APPLIED",
} as const
export type InventoryProposalReviewStatus =
  (typeof INVENTORY_PROPOSAL_REVIEW_STATUS)[keyof typeof INVENTORY_PROPOSAL_REVIEW_STATUS]

export const INVENTORY_PROPOSAL_REVIEW_STATUS_TRANSITIONS: Record<InventoryProposalReviewStatus, InventoryProposalReviewStatus[]> = {
  PENDING: [INVENTORY_PROPOSAL_REVIEW_STATUS.APPROVED, INVENTORY_PROPOSAL_REVIEW_STATUS.REJECTED],
  APPROVED: [INVENTORY_PROPOSAL_REVIEW_STATUS.APPLIED],
  REJECTED: [],
  APPLIED: [],
}

/**
 * Stage 5B.2 Medusa inventory sync state, tracked per proposal independently
 * of `review_status`. A proposal reaching `review_status = APPLIED` means the
 * authoritative local stock movement (holding + ledger) has committed — it
 * says nothing about whether Medusa's own InventoryItem/StockLocation level
 * reflects that yet. NOT_APPLICABLE covers every proposal that has not been
 * locally applied; PENDING is set the instant local application commits;
 * SYNCED/FAILED are terminal-per-attempt but FAILED may be retried (never the
 * reverse: once SYNCED, a stale/late result must never regress it to FAILED).
 */
export const MEDUSA_SYNC_STATUS = {
  NOT_APPLICABLE: "NOT_APPLICABLE",
  PENDING: "PENDING",
  SYNCED: "SYNCED",
  FAILED: "FAILED",
} as const
export type MedusaSyncStatus = (typeof MEDUSA_SYNC_STATUS)[keyof typeof MEDUSA_SYNC_STATUS]
/** After this lease, an interrupted PENDING attempt may be safely superseded by a retry token. */
export const MEDUSA_SYNC_ATTEMPT_LEASE_MS = 5 * 60 * 1000

/** Same lease protocol as `MEDUSA_SYNC_ATTEMPT_LEASE_MS`, for the "create a card from this unmatched Pulse row" claim. */
export const CARD_CREATION_CLAIM_LEASE_MS = 5 * 60 * 1000

/** Categorized, Admin-safe Medusa sync failure reasons — never a raw Medusa exception or stack trace. */
export const MEDUSA_SYNC_ERROR_CATEGORY = {
  INVALID_CONFIGURED_STOCK_LOCATION: "INVALID_CONFIGURED_STOCK_LOCATION",
  NO_STOCK_LOCATION: "NO_STOCK_LOCATION",
  AMBIGUOUS_STOCK_LOCATION: "AMBIGUOUS_STOCK_LOCATION",
  NO_PRODUCT_VARIANT_LINK: "NO_PRODUCT_VARIANT_LINK",
  NO_INVENTORY_ITEM_LINK: "NO_INVENTORY_ITEM_LINK",
  // A NEW_HOLDING sync is required to publish its Medusa product — if the
  // product variant somehow has no linked product at all, fail clearly
  // rather than silently returning SYNCED without publishing anything.
  NO_LINKED_MEDUSA_PRODUCT: "NO_LINKED_MEDUSA_PRODUCT",
  MEDUSA_LEVEL_READ_FAILED: "MEDUSA_LEVEL_READ_FAILED",
  MEDUSA_LEVEL_CREATE_FAILED: "MEDUSA_LEVEL_CREATE_FAILED",
  MEDUSA_LEVEL_UPDATE_FAILED: "MEDUSA_LEVEL_UPDATE_FAILED",
  MEDUSA_DEPENDENCY_FAILED: "MEDUSA_DEPENDENCY_FAILED",
  // E2B: category assignment, folded into this same Phase B sync/retry cycle.
  NO_LINKED_MEDUSA_CATEGORY: "NO_LINKED_MEDUSA_CATEGORY",
  CATEGORY_ASSIGNMENT_FAILED: "CATEGORY_ASSIGNMENT_FAILED",
  // A card's Medusa product is created as `draft` at Step 2 match/create
  // time (not yet customer-visible); this publishes it the first time real
  // stock is actually applied for it (NEW_HOLDING), never earlier.
  PRODUCT_PUBLISH_FAILED: "PRODUCT_PUBLISH_FAILED",
} as const
export type MedusaSyncErrorCategory = (typeof MEDUSA_SYNC_ERROR_CATEGORY)[keyof typeof MEDUSA_SYNC_ERROR_CATEGORY]

export function isValidInventorySnapshotTransition(from: InventorySnapshotStatus, to: InventorySnapshotStatus): boolean {
  return (INVENTORY_SNAPSHOT_STATUS_TRANSITIONS[from] ?? []).includes(to)
}

export function isValidInventoryHoldingTransition(from: InventoryHoldingStatus, to: InventoryHoldingStatus): boolean {
  return (INVENTORY_HOLDING_STATUS_TRANSITIONS[from] ?? []).includes(to)
}

export function isValidInventoryProposalTransition(from: InventoryProposalReviewStatus, to: InventoryProposalReviewStatus): boolean {
  return (INVENTORY_PROPOSAL_REVIEW_STATUS_TRANSITIONS[from] ?? []).includes(to)
}

export const INVENTORY_TRANSACTION_REASON = {
  APPROVED_SOURCE_SNAPSHOT: "APPROVED_SOURCE_SNAPSHOT",
  WEBSITE_SALE: "WEBSITE_SALE",
  EBAY_SALE: "EBAY_SALE",
  ORDER_CANCELLATION: "ORDER_CANCELLATION",
  REFUND_RESTOCK: "REFUND_RESTOCK",
  CONTROLLED_RECONCILIATION: "CONTROLLED_RECONCILIATION",
  MIGRATION_OPENING_BALANCE: "MIGRATION_OPENING_BALANCE",
} as const
export type InventoryTransactionReason =
  (typeof INVENTORY_TRANSACTION_REASON)[keyof typeof INVENTORY_TRANSACTION_REASON]

export const INVENTORY_AUDIT_ENTITY_TYPE = {
  INVENTORY_SOURCE: "INVENTORY_SOURCE",
  INVENTORY_SNAPSHOT: "INVENTORY_SNAPSHOT",
  INVENTORY_HOLDING: "INVENTORY_HOLDING",
  INVENTORY_PROPOSAL: "INVENTORY_PROPOSAL",
} as const
export type InventoryAuditEntityType = (typeof INVENTORY_AUDIT_ENTITY_TYPE)[keyof typeof INVENTORY_AUDIT_ENTITY_TYPE]

export const INVENTORY_AUDIT_ACTION = {
  SOURCE_CREATED: "SOURCE_CREATED",
  SOURCE_RENAMED: "SOURCE_RENAMED",
  SOURCE_ARCHIVED: "SOURCE_ARCHIVED",
  SOURCE_RESTORED: "SOURCE_RESTORED",
  SNAPSHOT_CREATED: "SNAPSHOT_CREATED",
  SNAPSHOT_STATUS_CHANGED: "SNAPSHOT_STATUS_CHANGED",
  SNAPSHOT_RECONCILED: "SNAPSHOT_RECONCILED",
  HOLDING_CREATED: "HOLDING_CREATED",
  HOLDING_QUANTITY_CHANGED: "HOLDING_QUANTITY_CHANGED",
  HOLDING_STATUS_CHANGED: "HOLDING_STATUS_CHANGED",
  PROPOSAL_CREATED: "PROPOSAL_CREATED",
  PROPOSAL_STATUS_CHANGED: "PROPOSAL_STATUS_CHANGED",
  PROPOSAL_REVIEWED: "PROPOSAL_REVIEWED",
  PROPOSAL_APPLICATION_ATTEMPTED: "PROPOSAL_APPLICATION_ATTEMPTED",
  PROPOSAL_APPLICATION_REJECTED_STALE_BASELINE: "PROPOSAL_APPLICATION_REJECTED_STALE_BASELINE",
  PROPOSAL_APPLICATION_REJECTED_SNAPSHOT_DISCARDED: "PROPOSAL_APPLICATION_REJECTED_SNAPSHOT_DISCARDED",
  PROPOSAL_APPLIED: "PROPOSAL_APPLIED",
  PROPOSAL_APPLICATION_RETRIED: "PROPOSAL_APPLICATION_RETRIED",
  MEDUSA_SYNC_SUCCEEDED: "MEDUSA_SYNC_SUCCEEDED",
  MEDUSA_SYNC_FAILED: "MEDUSA_SYNC_FAILED",
  MEDUSA_SYNC_RETRIED: "MEDUSA_SYNC_RETRIED",
  IMPORT_STARTED: "IMPORT_STARTED",
  IMPORT_DUPLICATE_DETECTED: "IMPORT_DUPLICATE_DETECTED",
  IMPORT_VALIDATION_FAILED: "IMPORT_VALIDATION_FAILED",
  IMPORT_ENTRIES_PERSISTED: "IMPORT_ENTRIES_PERSISTED",
  IMPORT_MATCHING_COMPLETED: "IMPORT_MATCHING_COMPLETED",
  IMPORT_RECONCILIATION_STARTED: "IMPORT_RECONCILIATION_STARTED",
  IMPORT_RECONCILIATION_COMPLETED: "IMPORT_RECONCILIATION_COMPLETED",
  IMPORT_PROPOSALS_REFRESHED: "IMPORT_PROPOSALS_REFRESHED",
  IMPORT_FAILED: "IMPORT_FAILED",
  PROPOSAL_VARIANT_RESOLVED: "PROPOSAL_VARIANT_RESOLVED",
  PROPOSAL_CATEGORY_PROPOSED: "PROPOSAL_CATEGORY_PROPOSED",
  PROPOSAL_CATEGORY_CONFIRMED: "PROPOSAL_CATEGORY_CONFIRMED",
  PROPOSAL_SPLIT: "PROPOSAL_SPLIT",
  /** Stage 1: a reviewer selected an alternative TCGdex card for a snapshot row that was matched (or unmatched) to the wrong card. */
  ENTRY_MATCH_REMATCHED: "ENTRY_MATCH_REMATCHED",
  /** Stage 1: a reviewer overrode the "requires separate listing" intent for a row or group. */
  PROPOSAL_SEPARATE_LISTING_OVERRIDDEN: "PROPOSAL_SEPARATE_LISTING_OVERRIDDEN",
} as const
export type InventoryAuditAction = (typeof INVENTORY_AUDIT_ACTION)[keyof typeof INVENTORY_AUDIT_ACTION]

/** Mirrors Stage 3's `RECORD_ORIGIN` shape; kept local to avoid a cross-module dependency on `trading-cards` for a single shared enum. */
export const INVENTORY_RECORD_SOURCE = { MANUAL: "MANUAL", PULSE: "PULSE", SYSTEM: "SYSTEM" } as const
export type InventoryRecordSource = (typeof INVENTORY_RECORD_SOURCE)[keyof typeof INVENTORY_RECORD_SOURCE]

/** Mirrors Stage 3's `EXTERNAL_REFERENCE_NOTE_MAX_LENGTH` bounded-note convention. */
export const INVENTORY_NOTE_MAX_LENGTH = 500
export const INVENTORY_SOURCE_NOTES_MAX_LENGTH = 1000
export const INVENTORY_PROVIDER_METADATA_MAX_BYTES = 2000

/**
 * Stage 5B.1 row outcome — set once at parse time, on the immutable
 * `InventorySnapshotEntry` row itself. Never revised after insert; matching
 * outcomes (which can be retried) live separately on the mutable
 * `InventorySnapshotEntryMatch` row.
 */
export const INVENTORY_SNAPSHOT_ENTRY_OUTCOME = {
  VALID: "VALID",
  VALID_WITH_WARNINGS: "VALID_WITH_WARNINGS",
  UNRESOLVED_VARIANT: "UNRESOLVED_VARIANT",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  INVALID: "INVALID",
  SKIPPED: "SKIPPED",
} as const
export type InventorySnapshotEntryOutcome =
  (typeof INVENTORY_SNAPSHOT_ENTRY_OUTCOME)[keyof typeof INVENTORY_SNAPSHOT_ENTRY_OUTCOME]

/** Mirrors Stage 3's `CONDITION_SOURCE`; kept local to avoid a cross-module dependency for one shared enum. */
export const INVENTORY_CONDITION_SOURCE = { EXPLICIT: "EXPLICIT", DEFAULTED: "DEFAULTED" } as const
export type InventoryConditionSource = (typeof INVENTORY_CONDITION_SOURCE)[keyof typeof INVENTORY_CONDITION_SOURCE]

/** Mirrors Stage 3's `CARD_CONDITION` value set; kept local so the pulse/ parser never imports across a module boundary. Values must stay identical to `trading-cards/types.ts`'s `CARD_CONDITION`. */
export const INVENTORY_CARD_CONDITION = {
  NEAR_MINT: "NEAR_MINT",
  LIGHTLY_PLAYED: "LIGHTLY_PLAYED",
  MODERATELY_PLAYED: "MODERATELY_PLAYED",
  HEAVILY_PLAYED: "HEAVILY_PLAYED",
  DAMAGED: "DAMAGED",
} as const
export type InventoryCardCondition = (typeof INVENTORY_CARD_CONDITION)[keyof typeof INVENTORY_CARD_CONDITION]

/** Mirrors Stage 3's `CARD_FINISH` value set; kept local for the same reason. */
export const INVENTORY_CARD_FINISH = { NORMAL: "NORMAL", HOLO: "HOLO", REVERSE_HOLO: "REVERSE_HOLO", OTHER: "OTHER" } as const
export type InventoryCardFinish = (typeof INVENTORY_CARD_FINISH)[keyof typeof INVENTORY_CARD_FINISH]

/** Mirrors Stage 3's `SPECIAL_TREATMENT` value set; kept local for the same reason. */
export const INVENTORY_SPECIAL_TREATMENT = {
  NONE: "NONE", ENERGY_REVERSE: "ENERGY_REVERSE", POKE_BALL_REVERSE: "POKE_BALL_REVERSE",
  MASTER_BALL_REVERSE: "MASTER_BALL_REVERSE", LOVE_BALL_REVERSE: "LOVE_BALL_REVERSE",
  QUICK_BALL_REVERSE: "QUICK_BALL_REVERSE", FRIEND_BALL_REVERSE: "FRIEND_BALL_REVERSE",
  DUSK_BALL_REVERSE: "DUSK_BALL_REVERSE", ROCKET_REVERSE: "ROCKET_REVERSE", POKE_BALL: "POKE_BALL",
  MASTER_BALL: "MASTER_BALL", STARLIGHT_HOLO: "STARLIGHT_HOLO", COSMOS_HOLO: "COSMOS_HOLO", TINSEL_HOLO: "TINSEL_HOLO",
  GALAXY_HOLO: "GALAXY_HOLO", CRACKED_ICE: "CRACKED_ICE", STAMPED: "STAMPED",
  PRERELEASE_STAMPED: "PRERELEASE_STAMPED", PROMOTIONAL_STAMPED: "PROMOTIONAL_STAMPED",
  TEXTURED: "TEXTURED", ETCHED: "ETCHED", OTHER: "OTHER",
} as const
export type InventorySpecialTreatment = (typeof INVENTORY_SPECIAL_TREATMENT)[keyof typeof INVENTORY_SPECIAL_TREATMENT]

/** Mirrors a conservative subset of Stage 3's `RARITY` value set — only rarities the Pulse mapper can safely infer without guessing. */
export const INVENTORY_RARITY = {
  COMMON: "COMMON", UNCOMMON: "UNCOMMON", DOUBLE_RARE: "DOUBLE_RARE", ULTRA_RARE: "ULTRA_RARE",
  ACE_SPEC: "ACE_SPEC", PROMO: "PROMO", NO_RARITY: "NO_RARITY",
} as const
export type InventoryRarity = (typeof INVENTORY_RARITY)[keyof typeof INVENTORY_RARITY]

export const INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS = {
  UNMATCHED: "UNMATCHED",
  MATCHED: "MATCHED",
  AMBIGUOUS: "AMBIGUOUS",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
} as const
export type InventorySnapshotEntryMatchingStatus =
  (typeof INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS)[keyof typeof INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS]

/**
 * How a snapshot entry's match was decided. `TRUSTED_REFERENCE` reuses an
 * existing `ExternalCardReference`; `UNIQUE_ATTRIBUTE_MATCH` is a uniquely
 * proven attribute match (only kind that may create a *new* trusted
 * reference); `NONE` means the entry is unmatched.
 */
export const INVENTORY_SNAPSHOT_ENTRY_MATCHED_VIA = {
  TRUSTED_REFERENCE: "TRUSTED_REFERENCE",
  UNIQUE_ATTRIBUTE_MATCH: "UNIQUE_ATTRIBUTE_MATCH",
  MANUAL: "MANUAL",
  NONE: "NONE",
} as const
export type InventorySnapshotEntryMatchedVia =
  (typeof INVENTORY_SNAPSHOT_ENTRY_MATCHED_VIA)[keyof typeof INVENTORY_SNAPSHOT_ENTRY_MATCHED_VIA]

export const INVENTORY_DIAGNOSTIC_PHASE = { PARSE: "PARSE", MATCHING: "MATCHING" } as const
export type InventoryDiagnosticPhase = (typeof INVENTORY_DIAGNOSTIC_PHASE)[keyof typeof INVENTORY_DIAGNOSTIC_PHASE]

export const INVENTORY_DIAGNOSTIC_SEVERITY = { INFO: "INFO", WARNING: "WARNING", ERROR: "ERROR" } as const
export type InventoryDiagnosticSeverity = (typeof INVENTORY_DIAGNOSTIC_SEVERITY)[keyof typeof INVENTORY_DIAGNOSTIC_SEVERITY]

export const INVENTORY_DIAGNOSTIC_MESSAGE_MAX_LENGTH = 500
export const INVENTORY_DIAGNOSTIC_FIELD_REF_MAX_LENGTH = 64
export const INVENTORY_DIAGNOSTIC_CODE_MAX_LENGTH = 64
/** Bounded allow-listed raw-field snapshot retained per entry; a full raw CSV row is never stored. */
export const INVENTORY_SNAPSHOT_ENTRY_RAW_FIELDS_MAX_BYTES = 4000
