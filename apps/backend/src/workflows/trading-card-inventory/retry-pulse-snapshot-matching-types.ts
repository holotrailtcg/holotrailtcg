import type { AuditContext } from "../../modules/trading-card-inventory/service"

/**
 * Stage 5B.1 Slice 3: narrow input for re-running matching against an
 * already-persisted snapshot. Deliberately has no file/filename/mimetype
 * fields — those only make sense for a fresh upload, not a retry.
 */
export interface RetryPulseSnapshotMatchingInput extends AuditContext {
  snapshotId: string
  /** Reconciliation baseline to use if this retry reaches VALIDATED/PENDING_REVIEW. */
  previousApprovedSnapshotId?: string | null
}
