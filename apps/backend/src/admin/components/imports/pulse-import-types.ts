export interface InventorySourceListItem {
  id: string
  displayName: string
  provider: string
  language: string | null
  status: "ACTIVE" | "ARCHIVED"
  defaultCurrencyCode: string | null
}

export interface InventorySourceListResponse {
  sources: InventorySourceListItem[]
  count: number
  limit: number
  offset: number
}

export interface ImportSummary {
  snapshotId: string
  inventorySourceId: string
  inventorySourceDisplayName: string
  inventorySourceLanguage: string | null
  status: string
  originalFilename: string
  contentHash: string
  rowCount: number
  byOutcome: Record<string, number>
  byMatchingStatus: Record<string, number>
  byDiagnosticSeverity: Record<string, number>
  uniqueProviderReferences: number
  duplicateRowCount: number
  approvedCardCount: number
  approvedQuantity: number
}

export interface ReconciliationSummary {
  snapshotId: string
  inventorySourceId: string
  status: string
  baselineSnapshotId: string | null
  comparedAt: string | null
  proposalCount: number
  proposalCounts: Record<string, number>
}

export interface ImportWarning {
  rowNumber: number
  phase: "PARSE" | "MATCHING"
  code: string
  severity: "INFO" | "WARNING" | "ERROR"
  fieldRef: string | null
  message: string
}

export type UploadCsvResult =
  | {
      kind: "IMPORTED"
      snapshotId: string
      inventorySourceId: string
      snapshotStatus: string
      importSummary: ImportSummary
      matchingSummary: Record<string, number>
      reconciliationSummary?: ReconciliationSummary
      warnings: ImportWarning[]
    }
  | { kind: "DUPLICATE"; snapshotId: string; inventorySourceId: string; snapshotStatus: string; importSummary: ImportSummary }
  | { kind: "VALIDATION_FAILED"; reason: string; diagnostics: ImportWarning[] }
  | { kind: "NO_USABLE_ROWS"; snapshotId: string; inventorySourceId: string; snapshotStatus: "FAILED" }
  | { kind: "SOURCE_ARCHIVED"; inventorySourceId?: string }

export interface SnapshotEntryListItem {
  id: string
  rowNumber: number | null
  providerReference: string
  quantity: number
  currencyCode: string | null
  unitAcquisitionCost: string | null
  unitMarketPrice: string | null
  unitSellingPrice: string | null
  conditionSource: string | null
  conditionCandidate: string | null
  finishCandidate: string | null
  specialTreatmentCandidate: string | null
  rarityCandidate: string | null
  rarityRaw: string | null
  languageConflict: boolean
  outcome: string | null
  tradingCardVariantId: string | null
  matchingStatus: string | null
  matchedVia: string | null
  retryCount: number
  card: InventoryProposalCardIdentity | null
  cardIdentityHint: string | null
  tcgdexCandidate: {
    id: string; reviewStatus: "PENDING" | "ACCEPTED"; matchOutcome: "MATCHED" | "AMBIGUOUS"
    name: string | null; setName: string; seriesName: string | null
    referenceArtworkUrl: string | null; providerRarity: string | null; illustrator: string | null
    candidateOptions: Array<{ tcgdexCardId: string; localId: string; name: string; image: string | null }> | null
  } | null
}

export interface SnapshotEntryListResponse {
  entries: SnapshotEntryListItem[]
  count: number
  limit: number
  offset: number
}

export interface SnapshotDiagnosticListItem {
  id: string
  snapshotEntryId: string
  rowNumber: number
  phase: "PARSE" | "MATCHING"
  code: string
  severity: "INFO" | "WARNING" | "ERROR"
  fieldRef: string | null
  message: string
}

export interface SnapshotDiagnosticListResponse {
  diagnostics: SnapshotDiagnosticListItem[]
  count: number
  limit: number
  offset: number
}

export interface InventorySnapshotListItem {
  id: string
  inventorySourceId: string
  status: string
  sequenceNumber: number
  originalFilename: string | null
  rowCount: number | null
  createdAt: string
}

export interface InventorySnapshotListResponse {
  snapshots: InventorySnapshotListItem[]
  count: number
  limit: number
  offset: number
}

export interface InventoryProposalCardIdentity {
  tradingCardId: string
  name: string
  setDisplayName: string
  cardNumber: string
  rarity: string | null
  rarityRaw: string | null
  condition: string
  finish: string
  specialTreatment: string
  sku: string
}

/** Stage 5B.2: `reviewStatus` (local application) and `medusaSyncStatus` (Medusa reflection) are always independent — never collapse them. */
export interface InventoryProposalListItem {
  id: string
  inventorySourceId: string
  inventorySnapshotId: string | null
  tradingCardVariantId: string | null
  card: InventoryProposalCardIdentity | null
  cardIdentityHint: string | null
  providerReference: string | null
  previousQuantity: number | null
  proposedQuantity: number | null
  quantityDelta: number | null
  changeKind: string
  reviewStatus: string
  resolvedBy: string | null
  resolvedAt: string | null
  reviewNote: string | null
  rejectionReason?: string | null
  appliedAt: string | null
  appliedTransactionId: string | null
  medusaSyncStatus: "NOT_APPLICABLE" | "PENDING" | "SYNCED" | "FAILED"
  medusaInventoryItemId: string | null
  medusaStockLocationId: string | null
  medusaSyncRetryCount: number
  medusaSyncLastError: { category: string; message: string; occurredAt?: string } | null
  createdAt: string
  proposedEbayStoreCategoryId: string | null
  proposedCategoryReason: string | null
  proposedCategoryRuleId: string | null
  confirmedEbayStoreCategoryId: string | null
  categoryConfirmedAt: string | null
  categoryConfirmedBy: string | null
}

export interface InventoryProposalListResponse {
  proposals: InventoryProposalListItem[]
  count: number
  limit: number
  offset: number
}

export interface InventoryAuditEntry {
  id: string
  actor: string
  action: string
  oldValue: unknown
  newValue: unknown
  reason: string | null
  source: string
  createdAt: string
}

export interface InventoryProposalDetailResponse {
  proposal: InventoryProposalListItem
  history: InventoryAuditEntry[]
}

export interface ImageReadiness {
  ready: boolean
  totalMatchedCards: number
  cardsWithPhoto: number
}

export interface SnapshotProgress {
  totalProposals: number
  pending: number
  approved: number
  rejected: number
  appliedFullySynced: number
  appliedSyncPending: number
  appliedSyncFailed: number
  blocked: number
  outOfScope: number
  allReviewed: boolean
  allApplicableApplied: boolean
  fullyComplete: boolean
}

export interface ApplyProposalItemResult {
  proposalId: string
  localApplicationStatus: "APPLIED" | "ALREADY_APPLIED" | "STALE_BASELINE" | "INVALID_STATE" | "OUT_OF_SCOPE"
  transactionId: string | null
  priorQuantity: number | null
  resultingQuantity: number | null
  medusaSyncStatus: string
  errorCode: string | null
  errorMessage: string | null
}
