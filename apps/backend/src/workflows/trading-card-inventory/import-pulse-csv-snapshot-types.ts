import type { AuditContext } from "../../modules/trading-card-inventory/service"

/**
 * Stage 5B.1 Slice 2: the provider-independent public input to the Pulse
 * import workflow. Never exposes a parser-library type (e.g. `csv-parse`
 * records) at this boundary — only bounded, already-decoded primitives.
 */
export interface ImportPulseCsvSnapshotInput extends AuditContext {
  /** Raw uploaded bytes, bounded to `PULSE_FILE_LIMITS.MAX_FILE_SIZE_BYTES`. Never written to disk or R2 by this workflow. */
  fileBuffer: Buffer
  originalFilename: string
  mimeType: string
  /** Path A: import against an already-existing, active source. */
  inventorySourceId?: string
  /** Path B: create-or-get a source by display name. Both fields are required together. */
  newSourceDisplayName?: string
  newSourceProvider?: string
  /** Required together with newSourceDisplayName/newSourceProvider — a new source must always have an explicit card language. */
  newSourceLanguage?: string
  newSourceDefaultCurrencyCode?: string | null
  previousApprovedSnapshotId?: string | null
  /** When set, skips source/file/snapshot creation and resumes matching/reconciliation for an existing snapshot. */
  retryOfSnapshotId?: string | null
  /**
   * Upload-level default answer to "Does this card require a separate
   * listing?" — applied to every row in this import. A later stage will use
   * this to drive physical-copy/separate-listing behaviour; for Stage 1 it
   * is carried through parsing, persistence, grouping and review only, and
   * never changes stock application. Reviewers can override it per group
   * during review (see `InventoryProposal.requires_separate_listing`).
   */
  requiresSeparateListingDefault?: boolean
}

export interface ImportSummary {
  snapshotId: unknown
  inventorySourceId: unknown
  status: unknown
  originalFilename: unknown
  contentHash: unknown
  rowCount: unknown
  byOutcome: Record<string, number>
  byMatchingStatus: Record<string, number>
  byDiagnosticSeverity: Record<string, number>
  uniqueProviderReferences: number
  duplicateRowCount: number
}

export interface ReconciliationSummary {
  snapshotId: unknown
  inventorySourceId: unknown
  status: unknown
  baselineSnapshotId: unknown
  comparedAt: unknown
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

/**
 * Discriminated result union. `IMPORTED` is a richer completion object (not
 * just identifiers) so a future Admin API can render a result without
 * issuing several follow-up read queries.
 */
export type ImportPulseCsvSnapshotResult =
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

/**
 * Internal error classification used to decide how the workflow's caller
 * should react to a thrown error that escapes the result union (i.e.
 * anything not already mapped to a `kind` above).
 * RETRYABLE: transient lock/connection contention — safe to replay unchanged.
 * TERMINAL: malformed bytes, header mismatch, oversized file — replay with
 *   the same input will always fail the same way.
 * DUPLICATE_SUCCESS: not an error — the workflow already resolved this to a
 *   `DUPLICATE` result; kept here only for documentation of the taxonomy.
 * USER_CORRECTABLE: archived source, zero usable rows — operator must change
 *   the target source or fix the file content.
 */
export type ImportPulseCsvSnapshotErrorClass =
  | { errorClass: "RETRYABLE"; step: string; cause: string }
  | { errorClass: "TERMINAL"; step: string; cause: string }
  | { errorClass: "DUPLICATE_SUCCESS"; snapshotId: string }
  | { errorClass: "USER_CORRECTABLE"; step: string; cause: string; hint: string }
