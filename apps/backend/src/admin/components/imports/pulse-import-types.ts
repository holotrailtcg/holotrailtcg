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

export type RetryMatchingResult =
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
  | { kind: "NO_USABLE_ROWS"; snapshotId: string; inventorySourceId: string; snapshotStatus: "FAILED" }

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
