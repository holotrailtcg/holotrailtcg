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
} as const
export type InventorySnapshotStatus = (typeof INVENTORY_SNAPSHOT_STATUS)[keyof typeof INVENTORY_SNAPSHOT_STATUS]

/**
 * Explicit, validated snapshot transition table. Each key's array lists the
 * statuses a snapshot in that state may move to; anything else is rejected.
 */
export const INVENTORY_SNAPSHOT_STATUS_TRANSITIONS: Record<InventorySnapshotStatus, InventorySnapshotStatus[]> = {
  DRAFT: [INVENTORY_SNAPSHOT_STATUS.VALIDATED, INVENTORY_SNAPSHOT_STATUS.FAILED],
  VALIDATED: [INVENTORY_SNAPSHOT_STATUS.PENDING_REVIEW, INVENTORY_SNAPSHOT_STATUS.FAILED],
  PENDING_REVIEW: [
    INVENTORY_SNAPSHOT_STATUS.APPROVED,
    INVENTORY_SNAPSHOT_STATUS.REJECTED,
    INVENTORY_SNAPSHOT_STATUS.SUPERSEDED,
  ],
  APPROVED: [
    INVENTORY_SNAPSHOT_STATUS.APPLYING,
    INVENTORY_SNAPSHOT_STATUS.SUPERSEDED,
  ],
  APPLYING: [INVENTORY_SNAPSHOT_STATUS.APPLIED, INVENTORY_SNAPSHOT_STATUS.FAILED],
  APPLIED: [INVENTORY_SNAPSHOT_STATUS.SUPERSEDED],
  REJECTED: [],
  FAILED: [],
  SUPERSEDED: [],
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
} as const
export type InventoryAuditAction = (typeof INVENTORY_AUDIT_ACTION)[keyof typeof INVENTORY_AUDIT_ACTION]

/** Mirrors Stage 3's `RECORD_ORIGIN` shape; kept local to avoid a cross-module dependency on `trading-cards` for a single shared enum. */
export const INVENTORY_RECORD_SOURCE = { MANUAL: "MANUAL", PULSE: "PULSE", SYSTEM: "SYSTEM" } as const
export type InventoryRecordSource = (typeof INVENTORY_RECORD_SOURCE)[keyof typeof INVENTORY_RECORD_SOURCE]

/** Mirrors Stage 3's `EXTERNAL_REFERENCE_NOTE_MAX_LENGTH` bounded-note convention. */
export const INVENTORY_NOTE_MAX_LENGTH = 500
export const INVENTORY_SOURCE_NOTES_MAX_LENGTH = 1000
export const INVENTORY_PROVIDER_METADATA_MAX_BYTES = 2000
