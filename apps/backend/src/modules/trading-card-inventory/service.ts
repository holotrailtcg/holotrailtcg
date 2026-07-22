import { createHash, randomUUID } from "node:crypto"
import { generateEntityId, MedusaError, MedusaService } from "@medusajs/framework/utils"
import InventorySource from "./models/inventory-source"
import InventorySnapshot from "./models/inventory-snapshot"
import InventoryHolding from "./models/inventory-holding"
import InventoryProposal from "./models/inventory-proposal"
import InventoryTransaction from "./models/inventory-transaction"
import InventoryAuditEntry from "./models/inventory-audit-entry"
import InventorySnapshotEntry from "./models/inventory-snapshot-entry"
import InventorySnapshotEntryMatch from "./models/inventory-snapshot-entry-match"
import InventorySnapshotEntryDiagnostic from "./models/inventory-snapshot-entry-diagnostic"
import InventorySnapshotEntryOverride from "./models/inventory-snapshot-entry-override"
import { normalizeSourceName } from "./identity/normalize-source-name"
import { aggregateSnapshotEntries, groupKey, reconcileSnapshots, type SnapshotEntryInput } from "./reconciliation/reconcile"
import { canonicalDecimal } from "./reconciliation/decimal"
import {
  auditContextSchema, createInventorySourceSchema, renameInventorySourceSchema, inventoryHoldingUpsertSchema,
  holdingStatusSchema, inventoryProposalCreateSchema, inventoryTransactionAppendSchema, idSchema,
  proposalReviewSchema, proposalApplySchema, proposalApplyBatchSchema, recordMedusaSyncResultSchema,
} from "./validation"
import {
  INVENTORY_AUDIT_ACTION, INVENTORY_AUDIT_ENTITY_TYPE, INVENTORY_HOLDING_STATUS,
  INVENTORY_PROPOSAL_REVIEW_STATUS, INVENTORY_PROPOSAL_CHANGE_KIND, INVENTORY_PROVIDER_REFERENCE_TYPE,
  INVENTORY_SNAPSHOT_STATUS, INVENTORY_SOURCE_STATUS, INVENTORY_TRANSACTION_REASON,
  INVENTORY_SNAPSHOT_ENTRY_OUTCOME, INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS, INVENTORY_SNAPSHOT_ENTRY_MATCHED_VIA,
  MEDUSA_SYNC_STATUS, MEDUSA_SYNC_ATTEMPT_LEASE_MS, CARD_CREATION_CLAIM_LEASE_MS,
  isValidInventoryHoldingTransition, isValidInventoryProposalTransition, isValidInventorySnapshotTransition,
  type InventoryHoldingStatus, type InventoryProposalReviewStatus, type InventoryProposalChangeKind,
  type InventoryRecordSource, type InventorySnapshotStatus, type MedusaSyncStatus,
} from "./types"

interface TxManager {
  execute<T = Record<string, unknown>>(query: string, params?: unknown[]): Promise<T[]>
}
interface EntityManager extends TxManager {
  transactional<T>(callback: (manager: TxManager) => Promise<T>): Promise<T>
}

export interface AuditContext { actor: string; source: InventoryRecordSource; reason?: string | null }

export interface CreateInventorySourceInput extends AuditContext {
  displayName: string
  provider: string
  language?: string | null
  defaultCurrencyCode?: string | null
  defaultPricingProfileKey?: string | null
  defaultStorefrontCategoryId?: string | null
  notes?: string | null
}

export interface UpsertInventoryHoldingInput extends AuditContext {
  inventorySourceId: string
  tradingCardVariantId: string
  quantity: number
  currencyCode?: string | null
  unitAcquisitionCost?: number | null
  unitMarketPrice?: number | null
  unitSellingPrice?: number | null
  providerReference?: string | null
}

export interface CreateInventoryProposalInput extends AuditContext {
  inventorySourceId: string
  inventorySnapshotId?: string | null
  tradingCardVariantId?: string | null
  providerReference?: string | null
  providerReferenceType?: string | null
  proposedQuantity?: number | null
  previousQuantity?: number | null
  currencyCode?: string | null
  proposedUnitAcquisitionCost?: number | null
  proposedUnitMarketPrice?: number | null
  proposedUnitSellingPrice?: number | null
  changeKind: string
}

export interface AppendInventoryTransactionInput extends AuditContext {
  tradingCardVariantId: string
  inventorySourceId?: string | null
  inventoryHoldingId?: string | null
  inventorySnapshotId?: string | null
  quantityBefore: number
  quantityAfter: number
  reason: string
  originatingReference?: string | null
  idempotencyKey?: string | null
  note?: string | null
}

export interface ReviewInventoryProposalsInput extends AuditContext {
  ids: string[]
  targetStatus: "APPROVED" | "REJECTED"
  rejectionReason?: string | null
  reviewNote?: string | null
}

export interface ApplyInventoryProposalInput extends AuditContext {
  id: string
  applicationIdempotencyKey?: string | null
}

export interface ApplyInventoryProposalItemResult {
  proposalId: string
  localApplicationStatus: "APPLIED" | "ALREADY_APPLIED" | "STALE_BASELINE" | "INVALID_STATE" | "OUT_OF_SCOPE" | "SNAPSHOT_DISCARDED"
  transactionId: string | null
  priorQuantity: number | null
  resultingQuantity: number | null
  medusaSyncStatus: MedusaSyncStatus
  errorCode: string | null
  errorMessage: string | null
}

export interface RecordMedusaSyncResultInput extends AuditContext {
  proposalId: string
  attemptToken: string
  outcome: "SYNCED" | "FAILED"
  medusaInventoryItemId?: string | null
  medusaStockLocationId?: string | null
  error?: { category: string; message: string } | null
}

export interface AddInventorySnapshotEntryInput extends SnapshotEntryInput {}

export interface ImportedDiagnosticInput {
  rowNumber: number
  phase: "PARSE" | "MATCHING"
  code: string
  severity: "INFO" | "WARNING" | "ERROR"
  fieldRef?: string | null
  message: string
}

/**
 * One Stage 5B.1 imported row, ready to persist. Mirrors `ParsedPulseRow`
 * (the pulse/ parser's pure output) but is declared independently here so
 * this module never depends on the parser's internal types — only the
 * workflow layer bridges the two.
 */
export interface ImportedSnapshotEntryInput {
  rowNumber: number
  outcome: string
  providerReference: string
  providerReferenceType: string
  tradingCardVariantId?: string | null
  quantity: number | null
  currencyCode?: string | null
  unitAcquisitionCost?: string | null
  unitMarketPrice?: string | null
  unitSellingPrice?: string | null
  conditionSource?: string | null
  conditionCandidate?: string | null
  finishCandidate?: string | null
  specialTreatmentCandidate?: string | null
  rarityCandidate?: string | null
  rarityRaw?: string | null
  languageConflict: boolean
  /** Stage 1: "Does this card require a separate listing?" — the upload-level default, prior to any row/group review override. */
  requiresSeparateListing?: boolean
  rawFields?: Record<string, string | null>
  diagnostics: ImportedDiagnosticInput[]
}

export interface RecordSnapshotEntryMatchInput {
  snapshotEntryId: string
  inventorySnapshotId: string
  matchingStatus: string
  tradingCardVariantId?: string | null
  matchedVia: string
  diagnostics: ImportedDiagnosticInput[]
}

export interface ReconcileInventorySnapshotInput extends AuditContext {
  inventorySourceId: string
  snapshotId: string
  previousApprovedSnapshotId?: string | null
  priceLockedVariantIds?: string[]
  comparedAt?: Date
}

/**
 * Thrown only by `createDraftSnapshot` when a concurrent upload wins the race
 * between the workflow's `findLiveSnapshotByContentHash` pre-check and the
 * insert — a rare safety-net case, not the primary duplicate-detection path
 * (that decision belongs to the workflow, which treats this identically to a
 * pre-check hit).
 */
export class DuplicateSnapshotError extends Error {
  existingSnapshotId: string
  constructor(existingSnapshotId: string) {
    super("An equivalent snapshot already exists for this source")
    this.name = "DuplicateSnapshotError"
    this.existingSnapshotId = existingSnapshotId
  }
}

export interface RecordSnapshotEntryMatchBatchItem {
  snapshotEntryId: string
  matchingStatus: string
  tradingCardVariantId?: string | null
  matchedVia: string
  diagnostics: ImportedDiagnosticInput[]
}

export interface RecordSnapshotEntryMatchesInput extends AuditContext {
  inventorySnapshotId: string
  entries: RecordSnapshotEntryMatchBatchItem[]
  refreshPendingProposals?: boolean
  priceLockedVariantIds?: string[]
}

class TradingCardInventoryModuleService extends MedusaService({
  InventorySource, InventorySnapshot, InventorySnapshotEntry, InventorySnapshotEntryMatch, InventorySnapshotEntryDiagnostic,
  InventorySnapshotEntryOverride, InventoryHolding, InventoryProposal, InventoryTransaction, InventoryAuditEntry,
}) {
  protected manager_: EntityManager

  constructor(container: { manager: EntityManager }) {
    // @ts-ignore MedusaService's generated constructor accepts the module container.
    super(...arguments)
    this.manager_ = container.manager
  }

  private lifecycleMutationBlocked = (name: string): never => {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `${name} is append-only and owned by explicit domain methods`)
  }

  // The ledger is append-only: every generated bulk mutator is blocked and
  // all writes go through appendInventoryTransaction.
  createInventoryTransactions = async (): Promise<never> => this.lifecycleMutationBlocked("Inventory transaction creation")
  updateInventoryTransactions = async (): Promise<never> => this.lifecycleMutationBlocked("Inventory transaction updates")
  deleteInventoryTransactions = async (): Promise<never> => this.lifecycleMutationBlocked("Inventory transaction deletion")
  softDeleteInventoryTransactions = async (): Promise<never> => this.lifecycleMutationBlocked("Inventory transaction deletion")
  restoreInventoryTransactions = async (): Promise<never> => this.lifecycleMutationBlocked("Inventory transaction restoration")

  updateInventoryAuditEntries = async (): Promise<never> => this.lifecycleMutationBlocked("Inventory audit entries are append-only")
  deleteInventoryAuditEntries = async (): Promise<never> => this.lifecycleMutationBlocked("Inventory audit entries cannot be deleted")
  softDeleteInventoryAuditEntries = async (): Promise<never> => this.lifecycleMutationBlocked("Inventory audit entries cannot be deleted")
  restoreInventoryAuditEntries = async (): Promise<never> => this.lifecycleMutationBlocked("Inventory audit entries cannot be restored")

  // Snapshot entries are immutable input facts. They can only be appended to
  // a DRAFT snapshot through addInventorySnapshotEntries.
  createInventorySnapshotEntries = async (): Promise<never> => this.lifecycleMutationBlocked("Snapshot entry creation")
  updateInventorySnapshotEntries = async (): Promise<never> => this.lifecycleMutationBlocked("Snapshot entry updates")
  deleteInventorySnapshotEntries = async (): Promise<never> => this.lifecycleMutationBlocked("Snapshot entry deletion")
  softDeleteInventorySnapshotEntries = async (): Promise<never> => this.lifecycleMutationBlocked("Snapshot entry deletion")
  restoreInventorySnapshotEntries = async (): Promise<never> => this.lifecycleMutationBlocked("Snapshot entry restoration")

  // Diagnostics are append-only, written only through recordSnapshotEntryDiagnostics.
  createInventorySnapshotEntryDiagnostics = async (): Promise<never> => this.lifecycleMutationBlocked("Snapshot entry diagnostic creation")
  updateInventorySnapshotEntryDiagnostics = async (): Promise<never> => this.lifecycleMutationBlocked("Snapshot entry diagnostics are append-only")
  deleteInventorySnapshotEntryDiagnostics = async (): Promise<never> => this.lifecycleMutationBlocked("Snapshot entry diagnostics cannot be deleted")
  softDeleteInventorySnapshotEntryDiagnostics = async (): Promise<never> => this.lifecycleMutationBlocked("Snapshot entry diagnostics cannot be deleted")
  restoreInventorySnapshotEntryDiagnostics = async (): Promise<never> => this.lifecycleMutationBlocked("Snapshot entry diagnostics cannot be restored")

  // Matches are only written/updated through recordSnapshotEntryMatch (create-or-update on retry).
  createInventorySnapshotEntryMatches = async (): Promise<never> => this.lifecycleMutationBlocked("Snapshot entry match creation")
  updateInventorySnapshotEntryMatches = async (): Promise<never> => this.lifecycleMutationBlocked("Snapshot entry match updates")
  deleteInventorySnapshotEntryMatches = async (): Promise<never> => this.lifecycleMutationBlocked("Snapshot entry match deletion")
  softDeleteInventorySnapshotEntryMatches = async (): Promise<never> => this.lifecycleMutationBlocked("Snapshot entry match deletion")
  restoreInventorySnapshotEntryMatches = async (): Promise<never> => this.lifecycleMutationBlocked("Snapshot entry match restoration")

  private async writeAudit(manager: TxManager, input: AuditContext & {
    entityType: string; entityId: string; action: string; oldValue?: unknown; newValue?: unknown
  }) {
    await manager.execute(
      `insert into trading_card_inventory_audit_entry
       (id, actor, entity_type, entity_id, action, old_value, new_value, reason, source)
       values (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?)`,
      [
        generateEntityId(undefined, "tciaud"), input.actor, input.entityType, input.entityId, input.action,
        input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
        input.newValue === undefined ? null : JSON.stringify(input.newValue),
        input.reason ?? null, input.source,
      ]
    )
  }

  /**
   * Locks a proposal's parent snapshot row (`for update`) and throws if it
   * has been discarded. `transitionInventorySnapshotStatus` takes the same
   * row lock when moving a snapshot to DISCARDED, so calling this from
   * every path that turns a proposal into a real inventory or card-creation
   * change (review, apply, begin/resolve card-creation claim) serialises
   * against a concurrent discard: whichever transaction commits its lock
   * first decides the outcome, and the loser always sees the fresh status —
   * never a stale "not yet discarded" read that lets stock move after the
   * snapshot was removed from the working list. A proposal with no snapshot
   * (`inventory_snapshot_id` is nullable) has nothing to discard, so it's a
   * no-op.
   */
  private async lockAndAssertSnapshotNotDiscarded(manager: TxManager, snapshotId: string | null): Promise<void> {
    if (!snapshotId) return
    const [snapshot] = await manager.execute<Record<string, unknown>>(
      `select status from trading_card_inventory_snapshot where id = ? for update`, [snapshotId]
    )
    if (snapshot && snapshot.status === INVENTORY_SNAPSHOT_STATUS.DISCARDED) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "This proposal's inventory snapshot has been discarded and can no longer be acted on"
      )
    }
  }

  // ---------------------------------------------------------------------
  // Inventory source
  // ---------------------------------------------------------------------

  async createInventorySource(input: CreateInventorySourceInput) {
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    const parsed = createInventorySourceSchema.parse({
      displayName: input.displayName, provider: input.provider, language: input.language ?? null,
      defaultCurrencyCode: input.defaultCurrencyCode ?? null, defaultPricingProfileKey: input.defaultPricingProfileKey ?? null,
      defaultStorefrontCategoryId: input.defaultStorefrontCategoryId ?? null, notes: input.notes ?? null,
    })
    const normalized = normalizeSourceName(parsed.displayName)
    return this.manager_.transactional(async (manager) => {
      await manager.execute(`select pg_advisory_xact_lock(hashtextextended(?::text, 0))`, [`source:${normalized}`])
      const [existing] = await manager.execute<Record<string, unknown>>(
        `select id from trading_card_inventory_source where normalized_name = ? and deleted_at is null`, [normalized]
      )
      if (existing) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "An inventory source with an equivalent name already exists")
      }
      const id = generateEntityId(undefined, "tcisrc")
      await manager.execute(
        `insert into trading_card_inventory_source
         (id, display_name, normalized_name, provider, language, status, default_currency_code, default_pricing_profile_key, default_storefront_category_id, notes)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, parsed.displayName, normalized, parsed.provider, parsed.language ?? null, INVENTORY_SOURCE_STATUS.ACTIVE,
          parsed.defaultCurrencyCode ?? null, parsed.defaultPricingProfileKey ?? null, parsed.defaultStorefrontCategoryId ?? null,
          parsed.notes ?? null,
        ]
      )
      await this.writeAudit(manager, {
        ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_SOURCE, entityId: id,
        action: INVENTORY_AUDIT_ACTION.SOURCE_CREATED,
        newValue: { displayName: parsed.displayName, provider: parsed.provider, language: parsed.language ?? null },
      })
      const [saved] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_source where id = ?`, [id]
      )
      return saved
    })
  }

  /**
   * Stage 5B.1: the import workflow's "use an existing active source or
   * create one" entry point. Unlike `createInventorySource` (which throws on
   * a name clash, for callers that want hard-fail-on-duplicate semantics),
   * this returns the existing row. Reuses the same advisory-lock key so the
   * module keeps a single concurrency strategy for this identity.
   */
  async createOrGetInventorySource(input: CreateInventorySourceInput): Promise<{ source: Record<string, unknown>; created: boolean }> {
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    const parsed = createInventorySourceSchema.parse({
      displayName: input.displayName, provider: input.provider, language: input.language ?? null,
      defaultCurrencyCode: input.defaultCurrencyCode ?? null, defaultPricingProfileKey: input.defaultPricingProfileKey ?? null,
      defaultStorefrontCategoryId: input.defaultStorefrontCategoryId ?? null, notes: input.notes ?? null,
    })
    const normalized = normalizeSourceName(parsed.displayName)
    return this.manager_.transactional(async (manager) => {
      await manager.execute(`select pg_advisory_xact_lock(hashtextextended(?::text, 0))`, [`source:${normalized}`])
      const [existing] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_source where normalized_name = ? and deleted_at is null`, [normalized]
      )
      if (existing) {
        if (existing.status === INVENTORY_SOURCE_STATUS.ARCHIVED) {
          throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This inventory source is archived and cannot receive new imports")
        }
        return { source: existing, created: false }
      }
      const id = generateEntityId(undefined, "tcisrc")
      await manager.execute(
        `insert into trading_card_inventory_source
         (id, display_name, normalized_name, provider, language, status, default_currency_code, default_pricing_profile_key, default_storefront_category_id, notes)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, parsed.displayName, normalized, parsed.provider, parsed.language ?? null, INVENTORY_SOURCE_STATUS.ACTIVE,
          parsed.defaultCurrencyCode ?? null, parsed.defaultPricingProfileKey ?? null, parsed.defaultStorefrontCategoryId ?? null,
          parsed.notes ?? null,
        ]
      )
      await this.writeAudit(manager, {
        ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_SOURCE, entityId: id,
        action: INVENTORY_AUDIT_ACTION.SOURCE_CREATED,
        newValue: { displayName: parsed.displayName, provider: parsed.provider, language: parsed.language ?? null },
      })
      const [saved] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_source where id = ?`, [id]
      )
      return { source: saved, created: true }
    })
  }

  async renameInventorySource(input: AuditContext & { id: string; displayName: string }) {
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    const parsed = renameInventorySourceSchema.parse({ id: input.id, displayName: input.displayName })
    const normalized = normalizeSourceName(parsed.displayName)
    return this.manager_.transactional(async (manager) => {
      await manager.execute(`select pg_advisory_xact_lock(hashtextextended(?::text, 0))`, [`source:${normalized}`])
      const [current] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_source where id = ? and deleted_at is null for update`, [parsed.id]
      )
      if (!current) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory source not found")
      if (current.normalized_name === normalized) return current
      const [clash] = await manager.execute<Record<string, unknown>>(
        `select id from trading_card_inventory_source where normalized_name = ? and id <> ? and deleted_at is null`,
        [normalized, parsed.id]
      )
      if (clash) throw new MedusaError(MedusaError.Types.INVALID_DATA, "An inventory source with an equivalent name already exists")
      await manager.execute(
        `update trading_card_inventory_source set display_name = ?, normalized_name = ?, updated_at = now() where id = ?`,
        [parsed.displayName, normalized, parsed.id]
      )
      await this.writeAudit(manager, {
        ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_SOURCE, entityId: parsed.id,
        action: INVENTORY_AUDIT_ACTION.SOURCE_RENAMED,
        oldValue: { displayName: current.display_name }, newValue: { displayName: parsed.displayName },
      })
      const [saved] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_source where id = ?`, [parsed.id]
      )
      return saved
    })
  }

  private async transitionSourceStatus(input: AuditContext & { id: string }, target: "ACTIVE" | "ARCHIVED") {
    idSchema.parse(input.id)
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    return this.manager_.transactional(async (manager) => {
      const [current] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_source where id = ? and deleted_at is null for update`, [input.id]
      )
      if (!current) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory source not found")
      if (current.status === target) return current
      await manager.execute(`update trading_card_inventory_source set status = ?, updated_at = now() where id = ?`, [target, input.id])
      await this.writeAudit(manager, {
        ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_SOURCE, entityId: input.id,
        action: target === "ARCHIVED" ? INVENTORY_AUDIT_ACTION.SOURCE_ARCHIVED : INVENTORY_AUDIT_ACTION.SOURCE_RESTORED,
        oldValue: { status: current.status }, newValue: { status: target },
      })
      const [saved] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_source where id = ?`, [input.id]
      )
      return saved
    })
  }

  async archiveInventorySource(input: AuditContext & { id: string }) { return this.transitionSourceStatus(input, "ARCHIVED") }
  async restoreInventorySource(input: AuditContext & { id: string }) { return this.transitionSourceStatus(input, "ACTIVE") }

  // ---------------------------------------------------------------------
  // Inventory snapshot
  // ---------------------------------------------------------------------

  async createInventorySnapshot(input: AuditContext & {
    inventorySourceId: string; originalFilename?: string | null; contentHash?: string | null
  }) {
    idSchema.parse(input.inventorySourceId)
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    return this.manager_.transactional(async (manager) => {
      const [source] = await manager.execute<Record<string, unknown>>(
        `select id, status from trading_card_inventory_source where id = ? and deleted_at is null for update`, [input.inventorySourceId]
      )
      if (!source) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory source not found")
      if (source.status !== INVENTORY_SOURCE_STATUS.ACTIVE) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This inventory source is archived and cannot receive new imports")
      }
      return this.insertDraftSnapshot(manager, input)
    })
  }

  private async insertDraftSnapshot(manager: TxManager, input: AuditContext & {
    inventorySourceId: string; originalFilename?: string | null; contentHash?: string | null
  }) {
    const [{ next_sequence }] = await manager.execute<{ next_sequence: number }>(
      `select coalesce(max(sequence_number), 0) + 1 as next_sequence from trading_card_inventory_snapshot where inventory_source_id = ?`,
      [input.inventorySourceId]
    )
    const id = generateEntityId(undefined, "tcisnap")
    await manager.execute(
      `insert into trading_card_inventory_snapshot
       (id, inventory_source_id, status, sequence_number, original_filename, content_hash, created_by)
       values (?, ?, ?, ?, ?, ?, ?)`,
      [id, input.inventorySourceId, INVENTORY_SNAPSHOT_STATUS.DRAFT, next_sequence, input.originalFilename ?? null, input.contentHash ?? null, input.actor]
    )
    await this.writeAudit(manager, {
      ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_SNAPSHOT, entityId: id,
      action: INVENTORY_AUDIT_ACTION.SNAPSHOT_CREATED,
      newValue: { inventorySourceId: input.inventorySourceId, sequenceNumber: next_sequence, status: INVENTORY_SNAPSHOT_STATUS.DRAFT },
    })
    const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_inventory_snapshot where id = ?`, [id])
    return saved
  }

  /**
   * Stage 5B.1: read-only lookup mirroring the partial unique index's own
   * predicate on `(inventory_source_id, content_hash)` exactly. Pure read, no
   * lock — duplicate-upload *decisions* belong to the import workflow, not
   * this method; it only answers "does a live snapshot already exist".
   */
  async findLiveSnapshotByContentHash(input: { inventorySourceId: string; contentHash: string }) {
    idSchema.parse(input.inventorySourceId)
    const [existing] = await this.manager_.execute<Record<string, unknown>>(
      `select * from trading_card_inventory_snapshot
       where inventory_source_id = ? and content_hash = ? and status not in ('REJECTED', 'FAILED', 'DISCARDED') and deleted_at is null`,
      [input.inventorySourceId, input.contentHash],
    )
    return existing ?? null
  }

  /**
   * Stage 5B.1: creates a DRAFT snapshot for a Pulse import, closing the
   * TOCTOU race between the workflow's `findLiveSnapshotByContentHash`
   * pre-check and this insert with an advisory lock scoped to
   * `(source, content_hash)`. Throws `DuplicateSnapshotError` in the rare
   * case a concurrent upload won that race — the workflow (not this method)
   * decides what a "duplicate" result means.
   */
  async createDraftSnapshot(input: AuditContext & { inventorySourceId: string; originalFilename?: string | null; contentHash: string }) {
    idSchema.parse(input.inventorySourceId)
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    return this.manager_.transactional(async (manager) => {
      await manager.execute(
        `select pg_advisory_xact_lock(hashtextextended(?::text, 0))`,
        [`snapshot-hash:${input.inventorySourceId}:${input.contentHash}`]
      )
      const [source] = await manager.execute<Record<string, unknown>>(
        `select id, status from trading_card_inventory_source where id = ? and deleted_at is null for update`, [input.inventorySourceId]
      )
      if (!source) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory source not found")
      if (source.status !== INVENTORY_SOURCE_STATUS.ACTIVE) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This inventory source is archived and cannot receive new imports")
      }
      const [existing] = await manager.execute<Record<string, unknown>>(
        `select id from trading_card_inventory_snapshot
         where inventory_source_id = ? and content_hash = ? and status not in ('REJECTED', 'FAILED', 'DISCARDED') and deleted_at is null`,
        [input.inventorySourceId, input.contentHash],
      )
      if (existing) throw new DuplicateSnapshotError(existing.id as string)
      return this.insertDraftSnapshot(manager, input)
    })
  }

  async transitionInventorySnapshotStatus(input: AuditContext & {
    id: string; targetStatus: InventorySnapshotStatus; rejectionReason?: string | null; failureReason?: string | null
  }) {
    idSchema.parse(input.id)
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    return this.manager_.transactional(async (manager) => {
      const [current] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_snapshot where id = ? and deleted_at is null for update`, [input.id]
      )
      if (!current) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory snapshot not found")
      const currentStatus = current.status as InventorySnapshotStatus
      if (currentStatus === input.targetStatus) return current
      if (!isValidInventorySnapshotTransition(currentStatus, input.targetStatus)) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `Cannot move a ${currentStatus} snapshot to ${input.targetStatus}`)
      }
      const extra: Record<string, unknown> = {}
      const assignments: string[] = ["status = ?"]
      const values: unknown[] = [input.targetStatus]
      if (input.targetStatus === INVENTORY_SNAPSHOT_STATUS.APPROVED) {
        assignments.push("approved_by = ?", "approved_at = now()")
        values.push(input.actor)
        extra.approvedBy = input.actor
      }
      if (input.targetStatus === INVENTORY_SNAPSHOT_STATUS.REJECTED) {
        assignments.push("rejected_by = ?", "rejected_at = now()", "rejection_reason = ?")
        values.push(input.actor, input.rejectionReason ?? null)
        extra.rejectedBy = input.actor
        extra.rejectionReason = input.rejectionReason ?? null
      }
      if (input.targetStatus === INVENTORY_SNAPSHOT_STATUS.FAILED) {
        assignments.push("failed_at = now()", "failure_reason = ?")
        values.push(input.failureReason ?? null)
        extra.failureReason = input.failureReason ?? null
      }
      await manager.execute(
        `update trading_card_inventory_snapshot set ${assignments.join(", ")}, updated_at = now() where id = ?`,
        [...values, input.id]
      )
      if (input.targetStatus === INVENTORY_SNAPSHOT_STATUS.DISCARDED) {
        // Belt-and-braces alongside the `for update` lock above and the
        // snapshot-status check every actionable proposal path now takes
        // (`lockAndAssertSnapshotNotDiscarded`): a live card-creation claim
        // for one of this snapshot's proposals is no longer honourable once
        // the snapshot is gone, so clear it here rather than leaving it to
        // expire on its own lease.
        await manager.execute(
          `update trading_card_inventory_proposal
           set card_creation_claim_token = null, card_creation_claimed_at = null, updated_at = now()
           where inventory_snapshot_id = ? and card_creation_claim_token is not null and deleted_at is null`,
          [input.id]
        )
      }
      await this.writeAudit(manager, {
        ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_SNAPSHOT, entityId: input.id,
        action: INVENTORY_AUDIT_ACTION.SNAPSHOT_STATUS_CHANGED,
        oldValue: { status: currentStatus }, newValue: { status: input.targetStatus, ...extra },
      })
      const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_inventory_snapshot where id = ?`, [input.id])
      return saved
    })
  }

  async addInventorySnapshotEntries(input: AuditContext & { snapshotId: string; entries: AddInventorySnapshotEntryInput[] }) {
    idSchema.parse(input.snapshotId)
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    if (!Array.isArray(input.entries) || input.entries.length === 0 || input.entries.length > 50_000) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Snapshot entries must contain between 1 and 50,000 rows")
    }
    const entries = input.entries.map((entry) => {
      if (!entry.providerReference || entry.providerReference.length > 255 ||
        !Object.values(INVENTORY_PROVIDER_REFERENCE_TYPE).includes(entry.providerReferenceType as never)) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Every snapshot entry requires a bounded provider reference and type")
      }
      if (!Number.isSafeInteger(entry.quantity) || entry.quantity < 0) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Snapshot entry quantities must be non-negative safe integers")
      }
      if (entry.currencyCode && !/^[A-Z]{3}$/.test(entry.currencyCode)) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Snapshot entry currency codes must be three uppercase letters")
      }
      const amounts = [entry.unitAcquisitionCost, entry.unitMarketPrice, entry.unitSellingPrice]
      if (amounts.some((amount) => amount !== null && amount !== undefined) && !entry.currencyCode) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Snapshot entry money amounts require a currency")
      }
      return {
        ...entry,
        unitAcquisitionCost: canonicalDecimal(entry.unitAcquisitionCost),
        unitMarketPrice: canonicalDecimal(entry.unitMarketPrice),
        unitSellingPrice: canonicalDecimal(entry.unitSellingPrice),
      }
    })
    return this.manager_.transactional(async (manager) => {
      const [snapshot] = await manager.execute<Record<string, unknown>>(
        `select id, status from trading_card_inventory_snapshot where id = ? and deleted_at is null for update`, [input.snapshotId]
      )
      if (!snapshot) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory snapshot not found")
      if (snapshot.status !== INVENTORY_SNAPSHOT_STATUS.DRAFT) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Snapshot entries can only be added while the snapshot is DRAFT")
      }
      for (let offset = 0; offset < entries.length; offset += 500) {
        const chunk = entries.slice(offset, offset + 500)
        const placeholders = chunk.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(", ")
        const params = chunk.flatMap((entry) => [
          generateEntityId(undefined, "tcisentry"), input.snapshotId, entry.providerReference, entry.providerReferenceType,
          entry.tradingCardVariantId ?? null, entry.quantity, entry.currencyCode ?? null,
          entry.unitAcquisitionCost ?? null, entry.unitMarketPrice ?? null, entry.unitSellingPrice ?? null,
        ])
        await manager.execute(
          `insert into trading_card_inventory_snapshot_entry
           (id, inventory_snapshot_id, provider_reference, provider_reference_type, trading_card_variant_id, quantity,
            currency_code, unit_acquisition_cost, unit_market_price, unit_selling_price) values ${placeholders}`,
          params,
        )
      }
      await manager.execute(
        `update trading_card_inventory_snapshot set row_count = (
           select count(*) from trading_card_inventory_snapshot_entry where inventory_snapshot_id = ? and deleted_at is null
         ), updated_at = now() where id = ?`, [input.snapshotId, input.snapshotId]
      )
      return { snapshotId: input.snapshotId, addedCount: entries.length }
    })
  }

  /**
   * Stage 5B.1: persists parsed, bounded rows as immutable snapshot entries
   * plus their PARSE-phase diagnostics, in one transaction per batch. Only
   * write-once columns are set here — matching results are written
   * separately (and only) by `recordSnapshotEntryMatch`.
   */
  async addInventorySnapshotEntriesWithDiagnostics(input: AuditContext & { snapshotId: string; rows: ImportedSnapshotEntryInput[] }) {
    idSchema.parse(input.snapshotId)
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    if (!Array.isArray(input.rows) || input.rows.length === 0 || input.rows.length > 50_000) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Imported rows must contain between 1 and 50,000 entries")
    }
    return this.manager_.transactional(async (manager) => {
      const [snapshot] = await manager.execute<Record<string, unknown>>(
        `select id, status from trading_card_inventory_snapshot where id = ? and deleted_at is null for update`, [input.snapshotId]
      )
      if (!snapshot) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory snapshot not found")
      const existingEntries = await manager.execute<{ id: string; row_number: number }>(
        `select id, row_number from trading_card_inventory_snapshot_entry
         where inventory_snapshot_id = ? and deleted_at is null order by row_number`,
        [input.snapshotId],
      )
      if (existingEntries.length > 0) {
        if (existingEntries.length !== input.rows.length || existingEntries.some((entry, index) => entry.row_number !== input.rows[index].rowNumber)) {
          throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "The draft snapshot already contains a different persisted row set")
        }
        return {
          snapshotId: input.snapshotId,
          addedCount: 0,
          entryIds: existingEntries.map((entry) => entry.id),
        }
      }
      if (snapshot.status !== INVENTORY_SNAPSHOT_STATUS.DRAFT) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Imported rows can only be added while the snapshot is DRAFT")
      }
      const entryIds: string[] = []
      for (let offset = 0; offset < input.rows.length; offset += 500) {
        const chunk = input.rows.slice(offset, offset + 500)
        const chunkIds = chunk.map(() => generateEntityId(undefined, "tcisentry"))
        entryIds.push(...chunkIds)
        const placeholders = chunk.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)`).join(", ")
        const params = chunk.flatMap((row, index) => {
          // A blank/malformed row may have no usable provider reference; a
          // synthetic bounded placeholder keeps the NOT-NULL/length
          // constraint satisfied without ever colliding with a real Pulse
          // reference (which always starts with "card:").
          const providerReference = row.providerReference.trim() || `__row_${input.snapshotId}_${row.rowNumber}__`
          return [
            chunkIds[index], input.snapshotId, providerReference.slice(0, 255), row.providerReferenceType,
            row.tradingCardVariantId ?? null, row.quantity ?? 0, row.currencyCode ?? null,
            canonicalDecimal(row.unitAcquisitionCost ?? null), canonicalDecimal(row.unitMarketPrice ?? null),
            canonicalDecimal(row.unitSellingPrice ?? null), row.rowNumber, row.outcome, row.conditionSource ?? null,
            row.conditionCandidate ?? null, row.finishCandidate ?? null, row.specialTreatmentCandidate ?? null,
            row.rarityCandidate ?? null, row.rarityRaw ?? null, row.languageConflict, Boolean(row.requiresSeparateListing),
            row.rawFields ? JSON.stringify(row.rawFields) : null,
          ]
        })
        await manager.execute(
          `insert into trading_card_inventory_snapshot_entry
           (id, inventory_snapshot_id, provider_reference, provider_reference_type, trading_card_variant_id, quantity,
            currency_code, unit_acquisition_cost, unit_market_price, unit_selling_price, row_number, outcome,
            condition_source, condition_candidate, finish_candidate, special_treatment_candidate, rarity_candidate, rarity_raw,
            language_conflict, requires_separate_listing, raw_fields) values ${placeholders}`,
          params,
        )
        const allDiagnostics = chunk.flatMap((row, index) => row.diagnostics.map((diagnostic) => ({ ...diagnostic, entryId: chunkIds[index] })))
        for (let diagOffset = 0; diagOffset < allDiagnostics.length; diagOffset += 500) {
          const diagChunk = allDiagnostics.slice(diagOffset, diagOffset + 500)
          if (diagChunk.length === 0) continue
          const diagPlaceholders = diagChunk.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(", ")
          const diagParams = diagChunk.flatMap((diagnostic) => [
            generateEntityId(undefined, "tcisediag"), diagnostic.entryId, input.snapshotId, diagnostic.rowNumber,
            diagnostic.phase, diagnostic.code, diagnostic.severity, diagnostic.fieldRef ?? null, diagnostic.message,
          ])
          await manager.execute(
            `insert into trading_card_inventory_snapshot_entry_diagnostic
             (id, snapshot_entry_id, inventory_snapshot_id, row_number, phase, code, severity, field_ref, message)
             values ${diagPlaceholders}`,
            diagParams,
          )
        }
      }
      await manager.execute(
        `update trading_card_inventory_snapshot set row_count = (
           select count(*) from trading_card_inventory_snapshot_entry where inventory_snapshot_id = ? and deleted_at is null
         ), updated_at = now() where id = ?`, [input.snapshotId, input.snapshotId]
      )
      return { snapshotId: input.snapshotId, addedCount: input.rows.length, entryIds }
    })
  }

  /** Stage 5B.1: writes or re-writes matching results for one entry. Create-or-update — the only writer of `InventorySnapshotEntryMatch`. Appends only semantically new MATCHING diagnostics. */
  async recordSnapshotEntryMatch(input: AuditContext & RecordSnapshotEntryMatchInput) {
    idSchema.parse(input.snapshotEntryId)
    idSchema.parse(input.inventorySnapshotId)
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    if (!Object.values(INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS).includes(input.matchingStatus as never)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid matching status")
    }
    if (!Object.values(INVENTORY_SNAPSHOT_ENTRY_MATCHED_VIA).includes(input.matchedVia as never)) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid matched-via value")
    }
    return this.manager_.transactional(async (manager) => {
      const [snapshot] = await manager.execute<Record<string, unknown>>(
        `select id, status from trading_card_inventory_snapshot where id = ? and deleted_at is null for update`,
        [input.inventorySnapshotId],
      )
      if (!snapshot) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory snapshot not found")
      if (![INVENTORY_SNAPSHOT_STATUS.DRAFT, INVENTORY_SNAPSHOT_STATUS.VALIDATED].includes(snapshot.status as never)) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Matching results cannot be changed in this snapshot state")
      }
      const [entry] = await manager.execute<Record<string, unknown>>(
        `select id from trading_card_inventory_snapshot_entry where id = ? and inventory_snapshot_id = ? and deleted_at is null`,
        [input.snapshotEntryId, input.inventorySnapshotId],
      )
      if (!entry) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Snapshot entry not found for this snapshot")
      const variantId = input.matchingStatus === INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS.MATCHED ? (input.tradingCardVariantId ?? null) : null
      const [existing] = await manager.execute<Record<string, unknown>>(
        `select id, retry_count from trading_card_inventory_snapshot_entry_match where snapshot_entry_id = ? and deleted_at is null for update`,
        [input.snapshotEntryId],
      )
      let matchId: string
      if (existing) {
        matchId = existing.id as string
        await manager.execute(
          `update trading_card_inventory_snapshot_entry_match set matching_status = ?, trading_card_variant_id = ?, matched_via = ?,
           matched_at = case when ? = 'MATCHED' then now() else null end, retry_count = retry_count + 1, last_retried_at = now(), updated_at = now()
           where id = ?`,
          [input.matchingStatus, variantId, input.matchedVia, input.matchingStatus, matchId],
        )
      } else {
        matchId = generateEntityId(undefined, "tcisematch")
        await manager.execute(
          `insert into trading_card_inventory_snapshot_entry_match
           (id, snapshot_entry_id, inventory_snapshot_id, matching_status, trading_card_variant_id, matched_via, matched_at)
           values (?, ?, ?, ?, ?, ?, case when ? = 'MATCHED' then now() else null end)`,
          [matchId, input.snapshotEntryId, input.inventorySnapshotId, input.matchingStatus, variantId, input.matchedVia, input.matchingStatus],
        )
      }
      for (const diagnostic of input.diagnostics) {
        await manager.execute(
          `insert into trading_card_inventory_snapshot_entry_diagnostic
           (id, snapshot_entry_id, inventory_snapshot_id, row_number, phase, code, severity, field_ref, message)
           select ?, ?, ?, ?, ?, ?, ?, ?, ?
           where not exists (
             select 1 from trading_card_inventory_snapshot_entry_diagnostic
             where snapshot_entry_id = ? and phase = ? and code = ? and severity = ?
               and field_ref is not distinct from ? and message = ? and deleted_at is null
           )`,
          [
            generateEntityId(undefined, "tcisediag"), input.snapshotEntryId, input.inventorySnapshotId, diagnostic.rowNumber,
            diagnostic.phase, diagnostic.code, diagnostic.severity, diagnostic.fieldRef ?? null, diagnostic.message,
            input.snapshotEntryId, diagnostic.phase, diagnostic.code, diagnostic.severity, diagnostic.fieldRef ?? null, diagnostic.message,
          ],
        )
      }
      const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_inventory_snapshot_entry_match where id = ?`, [matchId])
      return saved
    })
  }

  /**
   * Stage 5B.1: bulk create-or-update for the import workflow's matching
   * step — one transaction per chunk instead of one per row. Uses the
   * existing partial unique index on `snapshot_entry_id` as the upsert
   * target; a retry increments `retry_count` the same way the single-entry
   * `recordSnapshotEntryMatch` does. Diagnostics are append-only and
   * de-duplicated by their semantic identity.
   */
  async recordSnapshotEntryMatches(input: RecordSnapshotEntryMatchesInput) {
    idSchema.parse(input.inventorySnapshotId)
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    if (!Array.isArray(input.entries) || input.entries.length === 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "At least one match result is required")
    }
    for (const entry of input.entries) {
      idSchema.parse(entry.snapshotEntryId)
      if (!Object.values(INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS).includes(entry.matchingStatus as never)) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid matching status")
      }
      if (!Object.values(INVENTORY_SNAPSHOT_ENTRY_MATCHED_VIA).includes(entry.matchedVia as never)) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid matched-via value")
      }
    }
    return this.manager_.transactional(async (manager) => {
      const [snapshot] = await manager.execute<Record<string, unknown>>(
        `select id, status, inventory_source_id, reconciled_against_snapshot_id
         from trading_card_inventory_snapshot where id = ? and deleted_at is null for update`, [input.inventorySnapshotId]
      )
      if (!snapshot) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory snapshot not found")
      if (input.refreshPendingProposals && snapshot.status !== INVENTORY_SNAPSHOT_STATUS.PENDING_REVIEW) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Only a PENDING_REVIEW snapshot can refresh draft proposals after matching")
      }
      if (!input.refreshPendingProposals && snapshot.status === INVENTORY_SNAPSHOT_STATUS.PENDING_REVIEW) {
        const entryIds = input.entries.map((entry) => entry.snapshotEntryId)
        const currentMatches = await manager.execute<Record<string, unknown>>(
          `select e.id, m.matching_status, m.trading_card_variant_id, m.matched_via
           from trading_card_inventory_snapshot_entry e
           join trading_card_inventory_snapshot_entry_match m on m.snapshot_entry_id = e.id and m.deleted_at is null
           where e.inventory_snapshot_id = ? and e.id in (${entryIds.map(() => "?").join(", ")}) and e.deleted_at is null`,
          [input.inventorySnapshotId, ...entryIds],
        )
        const byId = new Map(currentMatches.map((row) => [row.id as string, row]))
        const unchanged = input.entries.every((entry) => {
          const current = byId.get(entry.snapshotEntryId)
          const variantId = entry.matchingStatus === INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS.MATCHED
            ? (entry.tradingCardVariantId ?? null)
            : null
          return current?.matching_status === entry.matchingStatus &&
            (current.trading_card_variant_id ?? null) === variantId && current.matched_via === entry.matchedVia
        })
        if (unchanged) {
          return { inventorySnapshotId: input.inventorySnapshotId, processedCount: input.entries.length, refreshedProposalCount: 0 }
        }
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Matching changes in PENDING_REVIEW require an atomic draft-proposal refresh")
      }
      if (!input.refreshPendingProposals &&
        ![INVENTORY_SNAPSHOT_STATUS.DRAFT, INVENTORY_SNAPSHOT_STATUS.VALIDATED].includes(snapshot.status as never)) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Matching results cannot be changed in this snapshot state")
      }

      const affectedKeys = new Set<string>()
      if (input.refreshPendingProposals) {
        for (let offset = 0; offset < input.entries.length; offset += 250) {
          const chunk = input.entries.slice(offset, offset + 250)
          const entryIds = chunk.map((entry) => entry.snapshotEntryId)
          const currentRows = await manager.execute<Record<string, unknown>>(
            `select e.id, e.provider_reference, e.provider_reference_type,
                    m.matching_status, m.trading_card_variant_id, m.matched_via
             from trading_card_inventory_snapshot_entry e
             left join trading_card_inventory_snapshot_entry_match m on m.snapshot_entry_id = e.id and m.deleted_at is null
             where e.id in (${entryIds.map(() => "?").join(", ")})
               and e.inventory_snapshot_id = ? and e.deleted_at is null`,
            [...entryIds, input.inventorySnapshotId],
          )
          const byId = new Map(currentRows.map((row) => [row.id as string, row]))
          for (const entry of chunk) {
            const current = byId.get(entry.snapshotEntryId)
            if (!current) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Snapshot entry not found for this snapshot")
            const nextVariantId = entry.matchingStatus === INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS.MATCHED
              ? (entry.tradingCardVariantId ?? null)
              : null
            if ((current.matching_status ?? null) !== entry.matchingStatus ||
              (current.trading_card_variant_id ?? null) !== nextVariantId ||
              (current.matched_via ?? null) !== entry.matchedVia) {
              affectedKeys.add(`${current.provider_reference_type}:${current.provider_reference}`)
            }
          }
        }
      }

      let affectedProposals: Record<string, unknown>[] = []
      if (affectedKeys.size > 0) {
        affectedProposals = await manager.execute<Record<string, unknown>>(
          `select * from trading_card_inventory_proposal
           where inventory_snapshot_id = ? and reconciliation_key in (${[...affectedKeys].map(() => "?").join(", ")})
             and deleted_at is null for update`,
          [input.inventorySnapshotId, ...affectedKeys],
        )
        if (affectedProposals.length !== affectedKeys.size ||
          affectedProposals.some((proposal) => proposal.review_status !== INVENTORY_PROPOSAL_REVIEW_STATUS.PENDING)) {
          throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            "Matching cannot be retried because an affected reconciliation proposal has already been actioned",
          )
        }
      }
      let processedCount = 0
      for (let offset = 0; offset < input.entries.length; offset += 250) {
        const chunk = input.entries.slice(offset, offset + 250)
        const entryIds = chunk.map((entry) => entry.snapshotEntryId)
        const owned = await manager.execute<{ id: string }>(
          `select id from trading_card_inventory_snapshot_entry
           where id in (${entryIds.map(() => "?").join(", ")}) and inventory_snapshot_id = ? and deleted_at is null`,
          [...entryIds, input.inventorySnapshotId],
        )
        const ownedIds = new Set(owned.map((row) => row.id))
        for (const entryId of entryIds) {
          if (!ownedIds.has(entryId)) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Snapshot entry not found for this snapshot")
        }
        const placeholders = chunk.map(() => `(?, ?, ?, ?, ?, ?, case when ? = 'MATCHED' then now() else null end)`).join(", ")
        const params = chunk.flatMap((entry) => {
          const variantId = entry.matchingStatus === INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS.MATCHED ? (entry.tradingCardVariantId ?? null) : null
          return [
            generateEntityId(undefined, "tcisematch"), entry.snapshotEntryId, input.inventorySnapshotId,
            entry.matchingStatus, variantId, entry.matchedVia, entry.matchingStatus,
          ]
        })
        await manager.execute(
          `insert into trading_card_inventory_snapshot_entry_match
           (id, snapshot_entry_id, inventory_snapshot_id, matching_status, trading_card_variant_id, matched_via, matched_at)
           values ${placeholders}
           on conflict (snapshot_entry_id) where deleted_at is null do update set
             matching_status = excluded.matching_status,
             trading_card_variant_id = excluded.trading_card_variant_id,
             matched_via = excluded.matched_via,
             matched_at = excluded.matched_at,
             retry_count = trading_card_inventory_snapshot_entry_match.retry_count + 1,
             last_retried_at = now(),
             updated_at = now()`,
          params,
        )
        const diagnosticKeys = new Set<string>()
        const allDiagnostics = chunk.flatMap((entry) => entry.diagnostics.map((diagnostic) => ({ ...diagnostic, entryId: entry.snapshotEntryId })))
          .filter((diagnostic) => {
            const key = JSON.stringify([diagnostic.entryId, diagnostic.phase, diagnostic.code, diagnostic.severity, diagnostic.fieldRef ?? null, diagnostic.message])
            if (diagnosticKeys.has(key)) return false
            diagnosticKeys.add(key)
            return true
          })
        for (let diagOffset = 0; diagOffset < allDiagnostics.length; diagOffset += 500) {
          const diagChunk = allDiagnostics.slice(diagOffset, diagOffset + 500)
          if (diagChunk.length === 0) continue
          const diagPlaceholders = diagChunk.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?)`).join(", ")
          const diagParams = diagChunk.flatMap((diagnostic) => [
            generateEntityId(undefined, "tcisediag"), diagnostic.entryId, input.inventorySnapshotId, diagnostic.rowNumber,
            diagnostic.phase, diagnostic.code, diagnostic.severity, diagnostic.fieldRef ?? null, diagnostic.message,
          ])
          await manager.execute(
            `insert into trading_card_inventory_snapshot_entry_diagnostic
             (id, snapshot_entry_id, inventory_snapshot_id, row_number, phase, code, severity, field_ref, message)
             select v.* from (values ${diagPlaceholders}) as v(id, snapshot_entry_id, inventory_snapshot_id, row_number, phase, code, severity, field_ref, message)
             where not exists (
               select 1 from trading_card_inventory_snapshot_entry_diagnostic d
               where d.snapshot_entry_id = v.snapshot_entry_id and d.phase = v.phase and d.code = v.code
                 and d.severity = v.severity and d.field_ref is not distinct from v.field_ref
                 and d.message = v.message and d.deleted_at is null
             )`,
            diagParams,
          )
        }
        processedCount += chunk.length
      }

      let refreshedProposalCount = 0
      if (affectedKeys.size > 0) {
        const loadRows = async (snapshotId: string) => manager.execute<Record<string, unknown>>(
          `select e.*, coalesce(m.trading_card_variant_id, e.trading_card_variant_id) as effective_trading_card_variant_id,
                  o.split_group_key as override_split_group_key, o.requires_separate_listing_override
           from trading_card_inventory_snapshot_entry e
           left join trading_card_inventory_snapshot_entry_match m on m.snapshot_entry_id = e.id and m.deleted_at is null
           left join trading_card_inventory_snapshot_entry_override o on o.snapshot_entry_id = e.id and o.deleted_at is null
           where e.inventory_snapshot_id = ? and e.deleted_at is null
             and (e.outcome is null or e.outcome not in ('INVALID', 'SKIPPED'))
           order by e.id`,
          [snapshotId],
        )
        const currentRows = await loadRows(input.inventorySnapshotId)
        const baselineSnapshotId = (snapshot.reconciled_against_snapshot_id as string | null) ?? null
        const previousRows = baselineSnapshotId ? await loadRows(baselineSnapshotId) : []
        const mapEntry = (row: Record<string, unknown>): SnapshotEntryInput => ({
          providerReference: row.provider_reference as string,
          providerReferenceType: row.provider_reference_type as string,
          tradingCardVariantId: (row.effective_trading_card_variant_id ?? row.trading_card_variant_id) as string | null,
          quantity: Number(row.quantity),
          currencyCode: row.currency_code as string | null,
          unitAcquisitionCost: row.unit_acquisition_cost === null ? null : String(row.unit_acquisition_cost),
          unitMarketPrice: row.unit_market_price === null ? null : String(row.unit_market_price),
          unitSellingPrice: row.unit_selling_price === null ? null : String(row.unit_selling_price),
          conditionCandidate: row.condition_candidate as string | null,
          finishCandidate: row.finish_candidate as string | null,
          specialTreatmentCandidate: row.special_treatment_candidate as string | null,
          requiresSeparateListing: row.requires_separate_listing_override !== null && row.requires_separate_listing_override !== undefined
            ? Boolean(row.requires_separate_listing_override) : Boolean(row.requires_separate_listing),
          splitGroupKey: (row.override_split_group_key as string | null) ?? null,
        })
        const proposalsByKey = new Map(reconcileSnapshots({
          previous: previousRows.map(mapEntry),
          current: currentRows.map(mapEntry),
          priceLockedVariantIds: new Set(input.priceLockedVariantIds ?? []),
        }).map((proposal) => [proposal.reconciliationKey, proposal]))
        const comparedAt = new Date()

        for (const currentProposal of affectedProposals) {
          const key = currentProposal.reconciliation_key as string
          const proposal = proposalsByKey.get(key)
          if (!proposal) {
            await manager.execute(
              `update trading_card_inventory_proposal set deleted_at = now(), updated_at = now()
               where id = ? and review_status = 'PENDING' and deleted_at is null`,
              [currentProposal.id],
            )
          } else {
            await manager.execute(
              `update trading_card_inventory_proposal set
                 trading_card_variant_id = ?, proposed_quantity = ?, previous_quantity = ?, quantity_delta = ?, currency_code = ?,
                 proposed_unit_acquisition_cost = ?, previous_unit_acquisition_cost = ?, proposed_unit_market_price = ?,
                 previous_unit_market_price = ?, proposed_unit_selling_price = ?, previous_unit_selling_price = ?,
                 change_kind = ?, reconciliation_reason = ?, reconciliation_diagnostics = ?::jsonb,
                 compared_at = ?, requires_separate_listing = ?, updated_at = now()
               where id = ? and review_status = 'PENDING' and deleted_at is null`,
              [
                proposal.tradingCardVariantId, proposal.proposedQuantity, proposal.previousQuantity, proposal.quantityDelta,
                proposal.currencyCode, proposal.proposedUnitAcquisitionCost, proposal.previousUnitAcquisitionCost,
                proposal.proposedUnitMarketPrice, proposal.previousUnitMarketPrice, proposal.proposedUnitSellingPrice,
                proposal.previousUnitSellingPrice, proposal.changeKind, proposal.reason,
                JSON.stringify({ changedFields: proposal.changedFields.slice(0, 8), duplicateRowCount: proposal.duplicateRowCount, sellingPriceLocked: proposal.sellingPriceLocked }),
                comparedAt, proposal.requiresSeparateListing, currentProposal.id,
              ],
            )
          }
          refreshedProposalCount += 1
        }
        await this.writeAudit(manager, {
          ...input,
          entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_SNAPSHOT,
          entityId: input.inventorySnapshotId,
          action: INVENTORY_AUDIT_ACTION.IMPORT_PROPOSALS_REFRESHED,
          newValue: { affectedProposalCount: refreshedProposalCount },
        })
      }
      return { inventorySnapshotId: input.inventorySnapshotId, processedCount, refreshedProposalCount }
    })
  }

  /**
   * Stage 5B.1: single-row audit write for import-lifecycle events that
   * don't naturally belong inside an existing domain-mutation transaction
   * (started, duplicate detected, matching completed, reconciliation
   * bracketing, failed). Keeps `writeAudit` calls owned by a service
   * transaction, never invoked directly from the workflow layer.
   */
  async recordImportLifecycleAudit(input: AuditContext & { snapshotId: string; action: string; newValue?: unknown }) {
    idSchema.parse(input.snapshotId)
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    return this.manager_.transactional((manager) => this.writeAudit(manager, {
      ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_SNAPSHOT, entityId: input.snapshotId,
      action: input.action, newValue: input.newValue,
    }))
  }

  /** Stage 5B.1: aggregate row/diagnostic/matching counts for the Admin preview screen — computed live, never stored redundantly. */
  async getSnapshotImportSummary(snapshotId: string) {
    idSchema.parse(snapshotId)
    const [snapshot] = await this.manager_.execute<Record<string, unknown>>(
      `select s.id, s.inventory_source_id, s.status, s.original_filename, s.content_hash, s.row_count,
              src.display_name as inventory_source_display_name, src.language as inventory_source_language
       from trading_card_inventory_snapshot s
       join trading_card_inventory_source src on src.id = s.inventory_source_id and src.deleted_at is null
       where s.id = ? and s.deleted_at is null`, [snapshotId]
    )
    if (!snapshot) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory snapshot not found")
    const byOutcome = await this.manager_.execute<{ key: string; count: string }>(
      `select outcome as key, count(*)::text as count from trading_card_inventory_snapshot_entry
       where inventory_snapshot_id = ? and deleted_at is null group by outcome`, [snapshotId]
    )
    const byMatchingStatus = await this.manager_.execute<{ key: string; count: string }>(
      `select matching_status as key, count(*)::text as count from trading_card_inventory_snapshot_entry_match
       where inventory_snapshot_id = ? and deleted_at is null group by matching_status`, [snapshotId]
    )
    const byDiagnosticSeverity = await this.manager_.execute<{ key: string; count: string }>(
      `select severity as key, count(*)::text as count from trading_card_inventory_snapshot_entry_diagnostic
       where inventory_snapshot_id = ? and deleted_at is null group by severity`, [snapshotId]
    )
    const [{ unique_references, duplicate_rows }] = await this.manager_.execute<{ unique_references: string; duplicate_rows: string }>(
      `select count(distinct provider_reference)::text as unique_references,
              (count(*) - count(distinct provider_reference))::text as duplicate_rows
       from trading_card_inventory_snapshot_entry where inventory_snapshot_id = ? and deleted_at is null`, [snapshotId]
    )
    const [{ approved_cards, approved_quantity }] = await this.manager_.execute<{ approved_cards: string; approved_quantity: string }>(
      `select count(distinct e.provider_reference)::text as approved_cards,
              coalesce(sum(e.quantity), 0)::text as approved_quantity
       from trading_card_inventory_snapshot_entry e
       inner join trading_card_inventory_snapshot_entry_match m
         on m.snapshot_entry_id = e.id and m.matching_status = 'MATCHED' and m.deleted_at is null
       inner join trading_card_inventory_snapshot s
         on s.id = e.inventory_snapshot_id and s.deleted_at is null
       inner join trading_card_inventory_source src
         on src.id = s.inventory_source_id and src.deleted_at is null
       inner join trading_card_provider_set_mapping set_mapping
         on set_mapping.provider = 'PULSE' and set_mapping.game = 'POKEMON'
        and set_mapping.language = src.language and set_mapping.deleted_at is null
        and lower(set_mapping.provider_set_code) = lower(replace(split_part(e.provider_reference, '|', 1), 'card:', ''))
       inner join trading_card_tcgdex_lookup_candidate lookup_candidate
         on lookup_candidate.provider = 'PULSE' and lookup_candidate.language = src.language
        and lookup_candidate.tcgdex_set_id = set_mapping.tcgdex_set_id
        and lookup_candidate.card_number = split_part(split_part(e.provider_reference, '|', 2), '/', 1)
        and lookup_candidate.match_outcome = 'MATCHED' and lookup_candidate.review_status = 'ACCEPTED'
        and lookup_candidate.deleted_at is null
       where e.inventory_snapshot_id = ? and e.deleted_at is null`, [snapshotId]
    )
    return {
      snapshotId: snapshot.id, inventorySourceId: snapshot.inventory_source_id, status: snapshot.status,
      inventorySourceDisplayName: snapshot.inventory_source_display_name,
      inventorySourceLanguage: snapshot.inventory_source_language ?? null,
      originalFilename: snapshot.original_filename, contentHash: snapshot.content_hash, rowCount: snapshot.row_count,
      byOutcome: Object.fromEntries(byOutcome.map((row) => [row.key, Number(row.count)])),
      byMatchingStatus: Object.fromEntries(byMatchingStatus.map((row) => [row.key, Number(row.count)])),
      byDiagnosticSeverity: Object.fromEntries(byDiagnosticSeverity.map((row) => [row.key, Number(row.count)])),
      uniqueProviderReferences: Number(unique_references), duplicateRowCount: Number(duplicate_rows),
      approvedCardCount: Number(approved_cards), approvedQuantity: Number(approved_quantity),
    }
  }

  /**
   * Distinct trading-card variants this snapshot has actually matched to,
   * used to gate "assign images before approval" — never includes rows still
   * unmatched, since those have no variant (and so no image) yet.
   */
  async listDistinctMatchedVariantIds(snapshotId: string): Promise<string[]> {
    idSchema.parse(snapshotId)
    const rows = await this.manager_.execute<{ trading_card_variant_id: string }>(
      `select distinct trading_card_variant_id from trading_card_inventory_snapshot_entry_match
       where inventory_snapshot_id = ? and matching_status = 'MATCHED' and trading_card_variant_id is not null and deleted_at is null`,
      [snapshotId]
    )
    return rows.map((row) => row.trading_card_variant_id)
  }

  /**
   * Distinct raw provider references for a snapshot's still-unmatched rows —
   * the caller parses each into a candidate set code (via `parseProductId`)
   * to find which sets need a TCGdex mapping before matching can resolve
   * them. Scoped to unmatched rows only: a row already matched doesn't need
   * its set re-checked.
   */
  async listDistinctUnmatchedProviderReferences(snapshotId: string): Promise<string[]> {
    idSchema.parse(snapshotId)
    const rows = await this.manager_.execute<{ provider_reference: string }>(
      `select distinct e.provider_reference from trading_card_inventory_snapshot_entry e
       inner join trading_card_inventory_snapshot_entry_match m on m.snapshot_entry_id = e.id and m.deleted_at is null
       where e.inventory_snapshot_id = ? and e.deleted_at is null
         and m.matching_status in ('UNMATCHED', 'AMBIGUOUS', 'REVIEW_REQUIRED')`,
      [snapshotId]
    )
    return rows.map((row) => row.provider_reference)
  }

  /**
   * Full rows (not just references) for a snapshot's still-unmatched
   * entries — the parsed-candidate columns a bulk TCGdex-match accept needs
   * to decide, per row, whether it has enough information to create a
   * variant automatically. One row per entry, not deduplicated by reference
   * (unlike `listDistinctUnmatchedProviderReferences`): a duplicate CSV row
   * still needs its own proposal resolved.
   */
  async listUnmatchedSnapshotEntriesForAdmin(snapshotId: string): Promise<Record<string, unknown>[]> {
    idSchema.parse(snapshotId)
    return this.manager_.execute<Record<string, unknown>>(
      `select e.*, m.matching_status, m.matched_via, m.retry_count,
              m.trading_card_variant_id as matched_trading_card_variant_id
       from trading_card_inventory_snapshot_entry e
       inner join trading_card_inventory_snapshot_entry_match m on m.snapshot_entry_id = e.id and m.deleted_at is null
       where e.inventory_snapshot_id = ? and e.deleted_at is null
         and m.matching_status in ('UNMATCHED', 'AMBIGUOUS', 'REVIEW_REQUIRED')`,
      [snapshotId]
    )
  }

  /**
   * Stage 1 alternative-match selection: one immutable entry plus its
   * current effective match state, snapshot id/status, and whether any
   * APPLIED proposal in this snapshot already covers its current variant —
   * everything `selectAlternativeTcgdexMatch` needs to validate and apply
   * a rematch safely.
   */
  async retrieveSnapshotEntryForRematch(entryId: string): Promise<Record<string, unknown> | null> {
    idSchema.parse(entryId)
    const [row] = await this.manager_.execute<Record<string, unknown>>(
      `select e.*, s.status as snapshot_status,
              coalesce(m.trading_card_variant_id, e.trading_card_variant_id) as effective_trading_card_variant_id,
              exists (
                select 1 from trading_card_inventory_proposal p
                where p.inventory_snapshot_id = e.inventory_snapshot_id and p.deleted_at is null
                  and p.review_status = 'APPLIED'
                  and p.trading_card_variant_id = coalesce(m.trading_card_variant_id, e.trading_card_variant_id)
              ) as current_variant_applied
       from trading_card_inventory_snapshot_entry e
       inner join trading_card_inventory_snapshot s on s.id = e.inventory_snapshot_id
       left join trading_card_inventory_snapshot_entry_match m on m.snapshot_entry_id = e.id and m.deleted_at is null
       where e.id = ? and e.deleted_at is null`,
      [entryId],
    )
    return row ?? null
  }

  /**
   * Stage 1 alternative-match selection: atomically locks the entry (so two
   * concurrent rematch requests for the same row serialise rather than
   * racing), re-validates that its current match hasn't already been
   * applied to stock, and writes the new match — all inside one
   * transaction, so the applied-status check can never go stale between
   * check and write. Delegates the actual write/reconciliation-refresh to
   * `recordSnapshotEntryMatches` (MikroORM nests this call as a savepoint
   * within the already-open transaction rather than opening a second one).
   */
  async selectAlternativeMatchForEntry(input: AuditContext & {
    snapshotEntryId: string; tradingCardVariantId: string; priceLockedVariantIds?: string[]
  }): Promise<{ previousVariantId: string | null; snapshotId: string }> {
    idSchema.parse(input.snapshotEntryId)
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    return this.manager_.transactional(async (manager) => {
      const [entry] = await manager.execute<Record<string, unknown>>(
        `select e.*, s.status as snapshot_status,
                coalesce(m.trading_card_variant_id, e.trading_card_variant_id) as effective_trading_card_variant_id
         from trading_card_inventory_snapshot_entry e
         inner join trading_card_inventory_snapshot s on s.id = e.inventory_snapshot_id
         left join trading_card_inventory_snapshot_entry_match m on m.snapshot_entry_id = e.id and m.deleted_at is null
         where e.id = ? and e.deleted_at is null for update`,
        [input.snapshotEntryId],
      )
      if (!entry) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Snapshot entry not found")
      await this.lockAndAssertSnapshotNotDiscarded(manager, entry.inventory_snapshot_id as string)

      const previousVariantId = (entry.effective_trading_card_variant_id as string | null) ?? null
      if (previousVariantId) {
        const [applied] = await manager.execute<{ exists: boolean }>(
          `select exists(
             select 1 from trading_card_inventory_proposal
             where inventory_snapshot_id = ? and deleted_at is null and review_status = 'APPLIED' and trading_card_variant_id = ?
           ) as exists`,
          [entry.inventory_snapshot_id, previousVariantId],
        )
        if (applied.exists) {
          throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            "This row's current match has already been applied to stock and cannot be rematched",
          )
        }
      }

      await this.recordSnapshotEntryMatches({
        actor: input.actor, source: input.source, reason: input.reason,
        inventorySnapshotId: entry.inventory_snapshot_id as string,
        entries: [{
          snapshotEntryId: input.snapshotEntryId, matchingStatus: INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS.MATCHED,
          tradingCardVariantId: input.tradingCardVariantId, matchedVia: INVENTORY_SNAPSHOT_ENTRY_MATCHED_VIA.MANUAL, diagnostics: [],
        }],
        refreshPendingProposals: entry.snapshot_status === INVENTORY_SNAPSHOT_STATUS.PENDING_REVIEW,
        priceLockedVariantIds: input.priceLockedVariantIds ?? [],
      })

      return { previousVariantId, snapshotId: entry.inventory_snapshot_id as string }
    })
  }

  /** Stage 5B.1: paginated, filterable entry listing for the Admin preview screen. */
  async listSnapshotEntriesForAdmin(
    snapshotId: string,
    filters: {
      outcome?: string; reviewStatus?: string; finishCandidate?: string; specialTreatmentCandidate?: string
      rarityCandidate?: string; duplicateReferenceOnly?: boolean; snapshotEntryId?: string; providerReference?: string
      sortBy?: string; sortDirection?: "asc" | "desc"
    },
    pagination: { limit: number; offset: number },
  ) {
    idSchema.parse(snapshotId)
    const conditions = ["e.inventory_snapshot_id = ?", "e.deleted_at is null"]
    const params: unknown[] = [snapshotId]
    if (filters.outcome) { conditions.push("e.outcome = ?"); params.push(filters.outcome) }
    const pendingTcgdexCandidate = `exists (
      select 1
      from trading_card_inventory_snapshot review_snapshot
      inner join trading_card_inventory_source review_source
        on review_source.id = review_snapshot.inventory_source_id and review_source.deleted_at is null
      inner join trading_card_provider_set_mapping set_mapping
        on set_mapping.provider = 'PULSE' and set_mapping.game = 'POKEMON'
       and set_mapping.language = review_source.language and set_mapping.deleted_at is null
       and lower(set_mapping.provider_set_code) = lower(replace(split_part(e.provider_reference, '|', 1), 'card:', ''))
      inner join trading_card_tcgdex_lookup_candidate lookup_candidate
        on lookup_candidate.provider = 'PULSE' and lookup_candidate.language = review_source.language
       and lookup_candidate.tcgdex_set_id = set_mapping.tcgdex_set_id
       and lookup_candidate.card_number = split_part(split_part(e.provider_reference, '|', 2), '/', 1)
       and lookup_candidate.match_outcome = 'MATCHED' and lookup_candidate.review_status = 'PENDING'
       and lookup_candidate.deleted_at is null
      where review_snapshot.id = e.inventory_snapshot_id and review_snapshot.deleted_at is null
    )`
    if (filters.reviewStatus === "ACTION_REQUIRED") {
      conditions.push(`(m.matching_status is null or m.matching_status <> 'MATCHED' or ${pendingTcgdexCandidate})`)
    } else if (filters.reviewStatus === "AWAITING_REVIEW") {
      conditions.push(`(m.matching_status = 'REVIEW_REQUIRED' or ${pendingTcgdexCandidate})`)
    } else if (filters.reviewStatus === "NOT_MATCHED") {
      conditions.push(`(m.matching_status is null or m.matching_status = 'UNMATCHED') and not ${pendingTcgdexCandidate}`)
    } else if (filters.reviewStatus === "MATCHED") {
      conditions.push("m.matching_status = 'MATCHED'")
    } else if (filters.reviewStatus === "AMBIGUOUS") {
      conditions.push("m.matching_status = 'AMBIGUOUS'")
    }
    if (filters.finishCandidate) { conditions.push("e.finish_candidate = ?"); params.push(filters.finishCandidate) }
    if (filters.specialTreatmentCandidate) { conditions.push("e.special_treatment_candidate = ?"); params.push(filters.specialTreatmentCandidate) }
    if (filters.rarityCandidate) { conditions.push("e.rarity_candidate = ?"); params.push(filters.rarityCandidate) }
    if (filters.snapshotEntryId) { conditions.push("e.id = ?"); params.push(filters.snapshotEntryId) }
    if (filters.providerReference) { conditions.push("e.provider_reference = ?"); params.push(filters.providerReference) }
    if (filters.duplicateReferenceOnly) {
      conditions.push(
        `e.provider_reference in (
          select provider_reference from trading_card_inventory_snapshot_entry
          where inventory_snapshot_id = ? and deleted_at is null group by provider_reference having count(*) > 1
        )`,
      )
      params.push(snapshotId)
    }
    const where = conditions.join(" and ")
    const sortExpressions: Record<string, string> = {
      cardName: "sort_card_name",
      set: "sort_set_name",
      quantity: "aggregated_quantity",
      purchasePrice: "unit_acquisition_cost",
      marketPrice: "unit_market_price",
      salePrice: "unit_selling_price",
      finish: "finish_candidate",
      variant: "special_treatment_candidate",
      rarity: "coalesce(rarity_candidate, rarity_raw)",
      reviewStatus: "sort_review_status",
    }
    const sortExpression = sortExpressions[filters.sortBy ?? "cardName"] ?? sortExpressions.cardName
    const sortDirection = filters.sortDirection === "desc" ? "desc" : "asc"
    const [{ count }] = await this.manager_.execute<{ count: string }>(
      `select count(distinct coalesce(e.provider_reference, e.id))::text as count from trading_card_inventory_snapshot_entry e
       left join trading_card_inventory_snapshot_entry_match m on m.snapshot_entry_id = e.id and m.deleted_at is null
       where ${where}`, params,
    )
    const rows = await this.manager_.execute<Record<string, unknown>>(
      `with ranked_entries as (
         select e.*, m.matching_status, m.matched_via, m.retry_count,
                m.trading_card_variant_id as matched_trading_card_variant_id,
                coalesce(matched_card.name, lookup_candidate.enrichment->>'name', e.provider_reference, '') as sort_card_name,
                coalesce(matched_set.display_name, set_mapping.tcgdex_set_name, '') as sort_set_name,
                case
                  when m.matching_status = 'REVIEW_REQUIRED' or lookup_candidate.id is not null then 'AWAITING_REVIEW'
                  when m.matching_status = 'MATCHED' then 'MATCHED'
                  when m.matching_status = 'AMBIGUOUS' then 'AMBIGUOUS'
                  else 'NOT_MATCHED'
                end as sort_review_status,
                (sum(e.quantity) over (partition by coalesce(e.provider_reference, e.id)))::int as aggregated_quantity,
                row_number() over (
                  partition by coalesce(e.provider_reference, e.id)
                  order by e.row_number asc nulls last, e.id asc
                ) as duplicate_rank
         from trading_card_inventory_snapshot_entry e
         left join trading_card_inventory_snapshot_entry_match m on m.snapshot_entry_id = e.id and m.deleted_at is null
         left join trading_card_inventory_snapshot sort_snapshot
           on sort_snapshot.id = e.inventory_snapshot_id and sort_snapshot.deleted_at is null
         left join trading_card_inventory_source sort_source
           on sort_source.id = sort_snapshot.inventory_source_id and sort_source.deleted_at is null
         left join trading_card_provider_set_mapping set_mapping
           on set_mapping.provider = 'PULSE' and set_mapping.game = 'POKEMON'
          and set_mapping.language = sort_source.language and set_mapping.deleted_at is null
          and lower(set_mapping.provider_set_code) = lower(replace(split_part(e.provider_reference, '|', 1), 'card:', ''))
         left join trading_card_tcgdex_lookup_candidate lookup_candidate
           on lookup_candidate.provider = 'PULSE' and lookup_candidate.language = sort_source.language
          and lookup_candidate.tcgdex_set_id = set_mapping.tcgdex_set_id
          and lookup_candidate.card_number = split_part(split_part(e.provider_reference, '|', 2), '/', 1)
          and lookup_candidate.match_outcome = 'MATCHED' and lookup_candidate.review_status = 'PENDING'
          and lookup_candidate.deleted_at is null
         left join trading_card_variant matched_variant
           on matched_variant.id = m.trading_card_variant_id and matched_variant.deleted_at is null
         left join trading_card matched_card
           on matched_card.id = matched_variant.trading_card_id and matched_card.deleted_at is null
         left join trading_card_set matched_set
           on matched_set.id = matched_card.card_set_id and matched_set.deleted_at is null
         where ${where}
       )
       select ranked_entries.*, aggregated_quantity as quantity
       from ranked_entries
       where duplicate_rank = 1
       order by ${sortExpression} ${sortDirection} nulls last, row_number asc nulls last
       limit ? offset ?`,
      [...params, pagination.limit, pagination.offset],
    )
    return { rows, count: Number(count) }
  }

  /** Stage 5B.1: paginated diagnostics for a single entry or the whole snapshot. */
  async listSnapshotEntryDiagnostics(snapshotId: string, filters: { severity?: string; snapshotEntryId?: string }, pagination: { limit: number; offset: number }) {
    idSchema.parse(snapshotId)
    const conditions = ["inventory_snapshot_id = ?", "deleted_at is null"]
    const params: unknown[] = [snapshotId]
    if (filters.severity) { conditions.push("severity = ?"); params.push(filters.severity) }
    if (filters.snapshotEntryId) { conditions.push("snapshot_entry_id = ?"); params.push(filters.snapshotEntryId) }
    const where = conditions.join(" and ")
    const [{ count }] = await this.manager_.execute<{ count: string }>(
      `select count(*)::text as count from trading_card_inventory_snapshot_entry_diagnostic where ${where}`, params,
    )
    const rows = await this.manager_.execute<Record<string, unknown>>(
      `select * from trading_card_inventory_snapshot_entry_diagnostic where ${where} order by row_number asc limit ? offset ?`,
      [...params, pagination.limit, pagination.offset],
    )
    return { rows, count: Number(count) }
  }

  async reconcileInventorySnapshot(input: ReconcileInventorySnapshotInput) {
    idSchema.parse(input.inventorySourceId)
    idSchema.parse(input.snapshotId)
    if (input.previousApprovedSnapshotId) idSchema.parse(input.previousApprovedSnapshotId)
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    const comparedAt = input.comparedAt ?? new Date()
    const lockedIds = new Set(input.priceLockedVariantIds ?? [])
    return this.manager_.transactional(async (manager) => {
      await manager.execute(`select pg_advisory_xact_lock(hashtextextended(?::text, 0))`, [`reconcile-source:${input.inventorySourceId}`])
      const [source] = await manager.execute<Record<string, unknown>>(
        `select id, status from trading_card_inventory_source where id = ? and deleted_at is null`, [input.inventorySourceId]
      )
      if (!source) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory source not found")
      if (source.status !== INVENTORY_SOURCE_STATUS.ACTIVE) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Only an active inventory source can be reconciled")
      }
      const [snapshot] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_snapshot where id = ? and inventory_source_id = ? and deleted_at is null for update`,
        [input.snapshotId, input.inventorySourceId],
      )
      if (!snapshot) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory snapshot not found for this source")
      if (snapshot.status === INVENTORY_SNAPSHOT_STATUS.PENDING_REVIEW && snapshot.reconciled_at) {
        if (input.previousApprovedSnapshotId !== undefined && input.previousApprovedSnapshotId !== null &&
          (snapshot.reconciled_against_snapshot_id ?? null) !== input.previousApprovedSnapshotId) {
          throw new MedusaError(MedusaError.Types.INVALID_DATA, "Snapshot was already reconciled against a different baseline")
        }
        return this.getReconciliationSummaryWithManager(manager, input.snapshotId)
      }
      if (snapshot.status !== INVENTORY_SNAPSHOT_STATUS.VALIDATED) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Only a VALIDATED snapshot can be reconciled")
      }

      const [latestEligibleBaseline] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_snapshot
         where inventory_source_id = ? and sequence_number < ? and approved_at is not null
           and status not in ('REJECTED', 'FAILED', 'SUPERSEDED', 'DISCARDED') and deleted_at is null
         order by sequence_number desc limit 1 for share`,
        [input.inventorySourceId, snapshot.sequence_number],
      )
      let baseline: Record<string, unknown> | undefined
      if (input.previousApprovedSnapshotId) {
        ;[baseline] = await manager.execute<Record<string, unknown>>(
          `select * from trading_card_inventory_snapshot
           where id = ? and inventory_source_id = ? and approved_at is not null and status not in ('REJECTED', 'FAILED', 'SUPERSEDED', 'DISCARDED')
             and deleted_at is null for share`,
          [input.previousApprovedSnapshotId, input.inventorySourceId],
        )
        if (!baseline) throw new MedusaError(MedusaError.Types.INVALID_DATA, "The reconciliation baseline must be an approved snapshot for this source")
        if (Number(baseline.sequence_number) >= Number(snapshot.sequence_number)) {
          throw new MedusaError(MedusaError.Types.INVALID_DATA, "The reconciliation baseline must precede the new snapshot")
        }
        if (latestEligibleBaseline && baseline.id !== latestEligibleBaseline.id) {
          throw new MedusaError(MedusaError.Types.INVALID_DATA, "The reconciliation baseline must be the latest eligible approved snapshot")
        }
      } else {
        baseline = latestEligibleBaseline
      }
      const baselineSnapshotId = (baseline?.id as string | undefined) ?? null

      // `outcome` is null for entries added through the older, non-Pulse
      // `addInventorySnapshotEntries` path (kept behaviour-identical here);
      // a Stage 5B.1 Pulse row with outcome INVALID/SKIPPED must never
      // influence a reconciliation group.
      const currentRows = await manager.execute<Record<string, unknown>>(
        `select e.*, coalesce(m.trading_card_variant_id, e.trading_card_variant_id) as effective_trading_card_variant_id,
                o.split_group_key as override_split_group_key, o.requires_separate_listing_override
         from trading_card_inventory_snapshot_entry e
         left join trading_card_inventory_snapshot_entry_match m on m.snapshot_entry_id = e.id and m.deleted_at is null
         left join trading_card_inventory_snapshot_entry_override o on o.snapshot_entry_id = e.id and o.deleted_at is null
         where e.inventory_snapshot_id = ? and e.deleted_at is null and (e.outcome is null or e.outcome not in ('INVALID', 'SKIPPED'))
         order by e.id`, [input.snapshotId]
      )
      const previousRows = baselineSnapshotId
        ? await manager.execute<Record<string, unknown>>(
          `select e.*, coalesce(m.trading_card_variant_id, e.trading_card_variant_id) as effective_trading_card_variant_id,
                  o.split_group_key as override_split_group_key, o.requires_separate_listing_override
           from trading_card_inventory_snapshot_entry e
           left join trading_card_inventory_snapshot_entry_match m on m.snapshot_entry_id = e.id and m.deleted_at is null
           left join trading_card_inventory_snapshot_entry_override o on o.snapshot_entry_id = e.id and o.deleted_at is null
           where e.inventory_snapshot_id = ? and e.deleted_at is null and (e.outcome is null or e.outcome not in ('INVALID', 'SKIPPED'))
           order by e.id`,
          [baselineSnapshotId],
        ) : []
      const mapEntry = (row: Record<string, unknown>): SnapshotEntryInput => ({
        providerReference: row.provider_reference as string,
        providerReferenceType: row.provider_reference_type as string,
        tradingCardVariantId: (row.effective_trading_card_variant_id ?? row.trading_card_variant_id) as string | null,
        quantity: Number(row.quantity), currencyCode: row.currency_code as string | null,
        unitAcquisitionCost: row.unit_acquisition_cost === null ? null : String(row.unit_acquisition_cost),
        unitMarketPrice: row.unit_market_price === null ? null : String(row.unit_market_price),
        unitSellingPrice: row.unit_selling_price === null ? null : String(row.unit_selling_price),
        splitGroupKey: (row.override_split_group_key as string | null) ?? null,
        conditionCandidate: row.condition_candidate as string | null,
        finishCandidate: row.finish_candidate as string | null,
        specialTreatmentCandidate: row.special_treatment_candidate as string | null,
        requiresSeparateListing: row.requires_separate_listing_override !== null && row.requires_separate_listing_override !== undefined
          ? Boolean(row.requires_separate_listing_override) : Boolean(row.requires_separate_listing),
      })
      const proposals = reconcileSnapshots({ previous: previousRows.map(mapEntry), current: currentRows.map(mapEntry), priceLockedVariantIds: lockedIds })
      for (let offset = 0; offset < proposals.length; offset += 250) {
        const chunk = proposals.slice(offset, offset + 250)
        const placeholders = chunk.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, 'PENDING', ?)`).join(", ")
        const params = chunk.flatMap((proposal) => [
          generateEntityId(undefined, "tciprop"), input.inventorySourceId, input.snapshotId,
          baselineSnapshotId, proposal.reconciliationKey, proposal.tradingCardVariantId,
          proposal.providerReference, proposal.providerReferenceType, proposal.proposedQuantity, proposal.previousQuantity,
          proposal.quantityDelta, proposal.currencyCode, proposal.proposedUnitAcquisitionCost, proposal.previousUnitAcquisitionCost,
          proposal.proposedUnitMarketPrice, proposal.previousUnitMarketPrice, proposal.proposedUnitSellingPrice,
          proposal.previousUnitSellingPrice, proposal.changeKind, proposal.reason,
          JSON.stringify({ changedFields: proposal.changedFields.slice(0, 8), duplicateRowCount: proposal.duplicateRowCount, sellingPriceLocked: proposal.sellingPriceLocked }),
          comparedAt,
          proposal.requiresSeparateListing,
        ])
        await manager.execute(
          `insert into trading_card_inventory_proposal
           (id, inventory_source_id, inventory_snapshot_id, baseline_snapshot_id, reconciliation_key, trading_card_variant_id,
            provider_reference, provider_reference_type, proposed_quantity, previous_quantity, quantity_delta, currency_code,
            proposed_unit_acquisition_cost, previous_unit_acquisition_cost, proposed_unit_market_price, previous_unit_market_price,
            proposed_unit_selling_price, previous_unit_selling_price, change_kind, reconciliation_reason,
            reconciliation_diagnostics, compared_at, review_status, requires_separate_listing) values ${placeholders}`,
          params,
        )
      }
      await manager.execute(
        `update trading_card_inventory_snapshot set status = ?, reconciled_against_snapshot_id = ?, reconciled_at = ?, updated_at = now() where id = ?`,
        [INVENTORY_SNAPSHOT_STATUS.PENDING_REVIEW, baselineSnapshotId, comparedAt, input.snapshotId],
      )
      await this.writeAudit(manager, {
        ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_SNAPSHOT, entityId: input.snapshotId,
        action: INVENTORY_AUDIT_ACTION.SNAPSHOT_RECONCILED,
        oldValue: { status: INVENTORY_SNAPSHOT_STATUS.VALIDATED },
        newValue: { status: INVENTORY_SNAPSHOT_STATUS.PENDING_REVIEW, baselineSnapshotId, proposalCount: proposals.length },
      })
      return this.getReconciliationSummaryWithManager(manager, input.snapshotId)
    })
  }

  async listSnapshotVariantIds(snapshotIds: string[]) {
    if (snapshotIds.length === 0 || snapshotIds.length > 2) return []
    snapshotIds.forEach((id) => idSchema.parse(id))
    const placeholders = snapshotIds.map(() => "?").join(", ")
    const rows = await this.manager_.execute<{ trading_card_variant_id: string }>(
      `select distinct coalesce(m.trading_card_variant_id, e.trading_card_variant_id) as trading_card_variant_id
       from trading_card_inventory_snapshot_entry e
       left join trading_card_inventory_snapshot_entry_match m on m.snapshot_entry_id = e.id and m.deleted_at is null
       where e.inventory_snapshot_id in (${placeholders})
         and coalesce(m.trading_card_variant_id, e.trading_card_variant_id) is not null and e.deleted_at is null
       order by trading_card_variant_id`, snapshotIds,
    )
    return rows.map((row) => row.trading_card_variant_id)
  }

  private async getReconciliationSummaryWithManager(manager: TxManager, snapshotId: string) {
    const [snapshot] = await manager.execute<Record<string, unknown>>(
      `select id, inventory_source_id, status, reconciled_against_snapshot_id, reconciled_at
       from trading_card_inventory_snapshot where id = ? and deleted_at is null`, [snapshotId]
    )
    if (!snapshot) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory snapshot not found")
    const counts = await manager.execute<{ change_kind: string; count: string }>(
      `select change_kind, count(*)::text as count from trading_card_inventory_proposal
       where inventory_snapshot_id = ? and deleted_at is null group by change_kind order by change_kind`, [snapshotId]
    )
    return {
      snapshotId: snapshot.id, inventorySourceId: snapshot.inventory_source_id, status: snapshot.status,
      baselineSnapshotId: snapshot.reconciled_against_snapshot_id ?? null, comparedAt: snapshot.reconciled_at ?? null,
      proposalCount: counts.reduce((sum, row) => sum + Number(row.count), 0),
      proposalCounts: Object.fromEntries(counts.map((row) => [row.change_kind, Number(row.count)])),
    }
  }

  async getReconciliationSummary(snapshotId: string) {
    idSchema.parse(snapshotId)
    return this.getReconciliationSummaryWithManager(this.manager_, snapshotId)
  }

  async getProposalSummary(snapshotId: string) {
    idSchema.parse(snapshotId)
    const [snapshot] = await this.manager_.execute<Record<string, unknown>>(
      `select id from trading_card_inventory_snapshot where id = ? and deleted_at is null`, [snapshotId]
    )
    if (!snapshot) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory snapshot not found")
    const byKind = await this.manager_.execute<{ key: string; count: string }>(
      `select change_kind as key, count(*)::text as count from trading_card_inventory_proposal
       where inventory_snapshot_id = ? and deleted_at is null group by change_kind order by change_kind`, [snapshotId]
    )
    const byStatus = await this.manager_.execute<{ key: string; count: string }>(
      `select review_status as key, count(*)::text as count from trading_card_inventory_proposal
       where inventory_snapshot_id = ? and deleted_at is null group by review_status order by review_status`, [snapshotId]
    )
    const byChangeKind = Object.fromEntries(byKind.map((row) => [row.key, Number(row.count)]))
    const byReviewStatus = Object.fromEntries(byStatus.map((row) => [row.key, Number(row.count)]))
    return {
      inventorySnapshotId: snapshotId,
      count: Object.values(byChangeKind).reduce((sum, count) => sum + count, 0),
      byChangeKind, byReviewStatus,
    }
  }

  // ---------------------------------------------------------------------
  // Inventory holding
  // ---------------------------------------------------------------------

  /**
   * Trusts `tradingCardVariantId` has already been validated to exist by the
   * caller (the `upsertInventoryHoldingWorkflow`, which resolves the
   * trading-cards module service to confirm it before this transaction
   * starts) — this module has no direct Postgres FK to another module's
   * table, matching how Stage 3 avoids in-DB FKs to Medusa's Product module.
   */
  async upsertInventoryHolding(input: UpsertInventoryHoldingInput) {
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    const parsed = inventoryHoldingUpsertSchema.parse({
      inventorySourceId: input.inventorySourceId, tradingCardVariantId: input.tradingCardVariantId, quantity: input.quantity,
      currencyCode: input.currencyCode ?? null, unitAcquisitionCost: input.unitAcquisitionCost ?? null,
      unitMarketPrice: input.unitMarketPrice ?? null, unitSellingPrice: input.unitSellingPrice ?? null,
      providerReference: input.providerReference ?? null,
    })
    return this.manager_.transactional(async (manager) => {
      await manager.execute(
        `select pg_advisory_xact_lock(hashtextextended(?::text, 0))`,
        [`holding:${parsed.inventorySourceId}:${parsed.tradingCardVariantId}`]
      )
      const [source] = await manager.execute<Record<string, unknown>>(
        `select id from trading_card_inventory_source where id = ? and deleted_at is null`, [parsed.inventorySourceId]
      )
      if (!source) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory source not found")
      const [current] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_holding
         where inventory_source_id = ? and trading_card_variant_id = ? and deleted_at is null for update`,
        [parsed.inventorySourceId, parsed.tradingCardVariantId]
      )
      const next = {
        quantity: parsed.quantity, currency_code: parsed.currencyCode ?? null,
        unit_acquisition_cost: parsed.unitAcquisitionCost ?? null, unit_market_price: parsed.unitMarketPrice ?? null,
        unit_selling_price: parsed.unitSellingPrice ?? null, provider_reference: parsed.providerReference ?? null,
      }
      if (current) {
        await manager.execute(
          `update trading_card_inventory_holding set quantity = ?, currency_code = ?, unit_acquisition_cost = ?,
           unit_market_price = ?, unit_selling_price = ?, provider_reference = ?, source_observed_at = now(), updated_at = now()
           where id = ?`,
          [next.quantity, next.currency_code, next.unit_acquisition_cost, next.unit_market_price, next.unit_selling_price, next.provider_reference, current.id]
        )
        await this.writeAudit(manager, {
          ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_HOLDING, entityId: current.id as string,
          action: INVENTORY_AUDIT_ACTION.HOLDING_QUANTITY_CHANGED,
          oldValue: { quantity: current.quantity }, newValue: { quantity: next.quantity },
        })
        const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_inventory_holding where id = ?`, [current.id])
        return saved
      }
      const id = generateEntityId(undefined, "tcihold")
      await manager.execute(
        `insert into trading_card_inventory_holding
         (id, inventory_source_id, trading_card_variant_id, status, quantity, currency_code, unit_acquisition_cost,
          unit_market_price, unit_selling_price, provider_reference, source_observed_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())`,
        [
          id, parsed.inventorySourceId, parsed.tradingCardVariantId, INVENTORY_HOLDING_STATUS.DRAFT, next.quantity,
          next.currency_code, next.unit_acquisition_cost, next.unit_market_price, next.unit_selling_price, next.provider_reference,
        ]
      )
      await this.writeAudit(manager, {
        ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_HOLDING, entityId: id,
        action: INVENTORY_AUDIT_ACTION.HOLDING_CREATED, newValue: { ...next, tradingCardVariantId: parsed.tradingCardVariantId },
      })
      const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_inventory_holding where id = ?`, [id])
      return saved
    })
  }

  async transitionInventoryHoldingStatus(input: AuditContext & { id: string; targetStatus: InventoryHoldingStatus }) {
    idSchema.parse(input.id)
    holdingStatusSchema.parse(input.targetStatus)
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    return this.manager_.transactional(async (manager) => {
      const [current] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_holding where id = ? and deleted_at is null for update`, [input.id]
      )
      if (!current) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory holding not found")
      const currentStatus = current.status as InventoryHoldingStatus
      if (currentStatus === input.targetStatus) return current
      if (!isValidInventoryHoldingTransition(currentStatus, input.targetStatus)) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `Cannot move a ${currentStatus} holding to ${input.targetStatus}`)
      }
      await manager.execute(`update trading_card_inventory_holding set status = ?, updated_at = now() where id = ?`, [input.targetStatus, input.id])
      await this.writeAudit(manager, {
        ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_HOLDING, entityId: input.id,
        action: INVENTORY_AUDIT_ACTION.HOLDING_STATUS_CHANGED,
        oldValue: { status: currentStatus }, newValue: { status: input.targetStatus },
      })
      const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_inventory_holding where id = ?`, [input.id])
      return saved
    })
  }

  // ---------------------------------------------------------------------
  // Inventory proposal
  // ---------------------------------------------------------------------

  /** Trusts `tradingCardVariantId` (when present) has already been validated by the `createInventoryProposalWorkflow`. */
  async createInventoryProposal(input: CreateInventoryProposalInput) {
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    const parsed = inventoryProposalCreateSchema.parse({
      inventorySourceId: input.inventorySourceId, inventorySnapshotId: input.inventorySnapshotId ?? null,
      tradingCardVariantId: input.tradingCardVariantId ?? null, providerReference: input.providerReference ?? null,
      providerReferenceType: input.providerReferenceType ?? null, proposedQuantity: input.proposedQuantity ?? null,
      previousQuantity: input.previousQuantity ?? null, currencyCode: input.currencyCode ?? null,
      proposedUnitAcquisitionCost: input.proposedUnitAcquisitionCost ?? null, proposedUnitMarketPrice: input.proposedUnitMarketPrice ?? null,
      proposedUnitSellingPrice: input.proposedUnitSellingPrice ?? null, changeKind: input.changeKind,
    })
    return this.manager_.transactional(async (manager) => {
      const [source] = await manager.execute<Record<string, unknown>>(
        `select id from trading_card_inventory_source where id = ? and deleted_at is null`, [parsed.inventorySourceId]
      )
      if (!source) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory source not found")
      if (parsed.inventorySnapshotId) {
        const [snapshot] = await manager.execute<Record<string, unknown>>(
          `select id from trading_card_inventory_snapshot where id = ? and inventory_source_id = ? and deleted_at is null`,
          [parsed.inventorySnapshotId, parsed.inventorySourceId]
        )
        if (!snapshot) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory snapshot not found for this source")
      }
      const id = generateEntityId(undefined, "tciprop")
      await manager.execute(
        `insert into trading_card_inventory_proposal
         (id, inventory_source_id, inventory_snapshot_id, trading_card_variant_id, provider_reference, provider_reference_type,
          proposed_quantity, previous_quantity, currency_code, proposed_unit_acquisition_cost, proposed_unit_market_price,
          proposed_unit_selling_price, change_kind, review_status)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, parsed.inventorySourceId, parsed.inventorySnapshotId ?? null, parsed.tradingCardVariantId ?? null,
          parsed.providerReference ?? null, parsed.providerReferenceType ?? null, parsed.proposedQuantity ?? null,
          parsed.previousQuantity ?? null, parsed.currencyCode ?? null, parsed.proposedUnitAcquisitionCost ?? null,
          parsed.proposedUnitMarketPrice ?? null, parsed.proposedUnitSellingPrice ?? null, parsed.changeKind,
          INVENTORY_PROPOSAL_REVIEW_STATUS.PENDING,
        ]
      )
      await this.writeAudit(manager, {
        ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_PROPOSAL, entityId: id,
        action: INVENTORY_AUDIT_ACTION.PROPOSAL_CREATED,
        newValue: { changeKind: parsed.changeKind, reviewStatus: INVENTORY_PROPOSAL_REVIEW_STATUS.PENDING },
      })
      const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_inventory_proposal where id = ?`, [id])
      return saved
    })
  }

  async transitionInventoryProposalStatus(input: AuditContext & {
    id: string; targetStatus: InventoryProposalReviewStatus; rejectionReason?: string | null
  }) {
    idSchema.parse(input.id)
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    return this.manager_.transactional(async (manager) => {
      const [current] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_proposal where id = ? and deleted_at is null for update`, [input.id]
      )
      if (!current) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory proposal not found")
      const currentStatus = current.review_status as InventoryProposalReviewStatus
      if (currentStatus === input.targetStatus) return current
      if (!isValidInventoryProposalTransition(currentStatus, input.targetStatus)) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, `Cannot move a ${currentStatus} proposal to ${input.targetStatus}`)
      }
      const assignments = ["review_status = ?"]
      const values: unknown[] = [input.targetStatus]
      const extra: Record<string, unknown> = {}
      if (input.targetStatus === INVENTORY_PROPOSAL_REVIEW_STATUS.APPROVED || input.targetStatus === INVENTORY_PROPOSAL_REVIEW_STATUS.REJECTED) {
        assignments.push("resolved_by = ?", "resolved_at = now()")
        values.push(input.actor)
        extra.resolvedBy = input.actor
      }
      if (input.targetStatus === INVENTORY_PROPOSAL_REVIEW_STATUS.REJECTED) {
        assignments.push("rejection_reason = ?")
        values.push(input.rejectionReason ?? null)
        extra.rejectionReason = input.rejectionReason ?? null
      }
      await manager.execute(
        `update trading_card_inventory_proposal set ${assignments.join(", ")}, updated_at = now() where id = ?`,
        [...values, input.id]
      )
      await this.writeAudit(manager, {
        ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_PROPOSAL, entityId: input.id,
        action: INVENTORY_AUDIT_ACTION.PROPOSAL_STATUS_CHANGED,
        oldValue: { reviewStatus: currentStatus }, newValue: { reviewStatus: input.targetStatus, ...extra },
      })
      const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_inventory_proposal where id = ?`, [input.id])
      return saved
    })
  }

  /**
   * Stage 1: moves a reviewer-selected, proper, non-empty subset of a
   * PENDING proposal's constituent source rows into a brand-new sibling
   * proposal, leaving the rest on the original. Never touches an
   * APPROVED/REJECTED/APPLIED proposal. Safe to retry: the split token (and
   * therefore the new proposal's `reconciliation_key`) is a deterministic
   * hash of `(proposalId, sortedSourceEntryIds)`, so an identical repeat
   * request finds the already-created sibling and returns it unchanged
   * rather than creating a duplicate. A concurrent conflicting split (e.g.
   * against rows another admin already moved out) is rejected with a clear
   * "no longer part of this group" error rather than silently corrupting
   * either group, since the proposal row lock serializes concurrent callers.
   */
  async splitInventoryProposal(input: AuditContext & { proposalId: string; sourceEntryIds: string[] }): Promise<{
    originalProposalId: string; newProposalId: string; movedEntryIds: string[]; alreadySplit: boolean
  }> {
    idSchema.parse(input.proposalId)
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    if (!Array.isArray(input.sourceEntryIds) || input.sourceEntryIds.length === 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "At least one source row must be selected to split")
    }
    const uniqueEntryIds = [...new Set(input.sourceEntryIds)]
    uniqueEntryIds.forEach((entryId) => idSchema.parse(entryId))

    const loadGroupRows = async (manager: TxManager, snapshotId: string, whereEntryIds?: string[]) => manager.execute<Record<string, unknown>>(
      `select e.*, coalesce(m.trading_card_variant_id, e.trading_card_variant_id) as effective_trading_card_variant_id,
              o.split_group_key as override_split_group_key, o.requires_separate_listing_override
       from trading_card_inventory_snapshot_entry e
       left join trading_card_inventory_snapshot_entry_match m on m.snapshot_entry_id = e.id and m.deleted_at is null
       left join trading_card_inventory_snapshot_entry_override o on o.snapshot_entry_id = e.id and o.deleted_at is null
       where e.inventory_snapshot_id = ? and e.deleted_at is null
         and (e.outcome is null or e.outcome not in ('INVALID', 'SKIPPED'))
         ${whereEntryIds ? `and e.id in (${whereEntryIds.map(() => "?").join(", ")})` : ""}
       order by e.id`,
      whereEntryIds ? [snapshotId, ...whereEntryIds] : [snapshotId],
    )
    const mapRow = (row: Record<string, unknown>): SnapshotEntryInput & { id: string } => ({
      id: row.id as string,
      providerReference: row.provider_reference as string,
      providerReferenceType: row.provider_reference_type as string,
      tradingCardVariantId: (row.effective_trading_card_variant_id ?? row.trading_card_variant_id) as string | null,
      quantity: Number(row.quantity),
      currencyCode: row.currency_code as string | null,
      unitAcquisitionCost: row.unit_acquisition_cost === null ? null : String(row.unit_acquisition_cost),
      unitMarketPrice: row.unit_market_price === null ? null : String(row.unit_market_price),
      unitSellingPrice: row.unit_selling_price === null ? null : String(row.unit_selling_price),
      conditionCandidate: row.condition_candidate as string | null,
      finishCandidate: row.finish_candidate as string | null,
      specialTreatmentCandidate: row.special_treatment_candidate as string | null,
      requiresSeparateListing: row.requires_separate_listing_override !== null && row.requires_separate_listing_override !== undefined
        ? Boolean(row.requires_separate_listing_override) : Boolean(row.requires_separate_listing),
      splitGroupKey: (row.override_split_group_key as string | null) ?? null,
    })

    return this.manager_.transactional(async (manager) => {
      const [proposal] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_proposal where id = ? and deleted_at is null for update`, [input.proposalId]
      )
      if (!proposal) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory proposal not found")
      if (proposal.review_status !== INVENTORY_PROPOSAL_REVIEW_STATUS.PENDING) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Cannot split a ${proposal.review_status} proposal — only a PENDING proposal can be split`)
      }
      const snapshotId = (proposal.inventory_snapshot_id as string | null) ?? null
      if (!snapshotId) throw new MedusaError(MedusaError.Types.INVALID_DATA, "This proposal has no snapshot and cannot be split")
      await this.lockAndAssertSnapshotNotDiscarded(manager, snapshotId)
      const reconciliationKey = proposal.reconciliation_key as string | null
      if (!reconciliationKey) throw new MedusaError(MedusaError.Types.INVALID_DATA, "This proposal has no grouping key and cannot be split")

      const selectedRows = await loadGroupRows(manager, snapshotId, uniqueEntryIds)
      if (selectedRows.length !== uniqueEntryIds.length) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "One or more selected rows do not exist in this snapshot")
      }
      const sortedIds = [...uniqueEntryIds].sort()
      const splitToken = createHash("sha256").update(`${input.proposalId}:${sortedIds.join(",")}`).digest("hex").slice(0, 16)
      const hypotheticalMoved = { ...mapRow(selectedRows[0]), splitGroupKey: splitToken }
      const newKey = groupKey(hypotheticalMoved)

      const [existingNew] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_proposal where inventory_snapshot_id = ? and reconciliation_key = ? and deleted_at is null`,
        [snapshotId, newKey],
      )
      if (existingNew) {
        return { originalProposalId: proposal.id as string, newProposalId: existingNew.id as string, movedEntryIds: uniqueEntryIds, alreadySplit: true }
      }

      const allRows = (await loadGroupRows(manager, snapshotId)).map(mapRow)
      const currentGroup = allRows.filter((entry) => groupKey(entry) === reconciliationKey)
      const currentGroupIds = new Set(currentGroup.map((entry) => entry.id))
      const notInGroup = uniqueEntryIds.filter((entryId) => !currentGroupIds.has(entryId))
      if (notInGroup.length > 0) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "One or more selected rows are no longer part of this proposal's current group — reload and try again",
        )
      }
      if (uniqueEntryIds.length >= currentGroup.length) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "A split must move a proper, non-empty subset of the group's rows — not all of them")
      }

      const movedSet = new Set(uniqueEntryIds)
      const remainingInput = currentGroup.filter((entry) => !movedSet.has(entry.id))
      const movedInput = currentGroup.filter((entry) => movedSet.has(entry.id)).map((entry) => ({ ...entry, splitGroupKey: splitToken }))

      for (const entryId of uniqueEntryIds) {
        await manager.execute(
          `insert into trading_card_inventory_snapshot_entry_override (id, snapshot_entry_id, inventory_snapshot_id, split_group_key)
           values (?, ?, ?, ?)
           on conflict (snapshot_entry_id) where deleted_at is null
           do update set split_group_key = excluded.split_group_key, updated_at = now()`,
          [generateEntityId(undefined, "tciseovr"), entryId, snapshotId, splitToken],
        )
      }

      const [remainingAgg] = [...aggregateSnapshotEntries(remainingInput).values()]
      const [movedAgg] = [...aggregateSnapshotEntries(movedInput).values()]

      await manager.execute(
        `update trading_card_inventory_proposal set
           trading_card_variant_id = ?, proposed_quantity = ?, quantity_delta = ?, currency_code = ?,
           proposed_unit_acquisition_cost = ?, proposed_unit_market_price = ?, proposed_unit_selling_price = ?,
           requires_separate_listing = ?, reconciliation_reason = ?, updated_at = now()
         where id = ?`,
        [
          remainingAgg.tradingCardVariantId, remainingAgg.quantity,
          remainingAgg.quantity - Number(proposal.previous_quantity ?? 0), remainingAgg.currencyCode,
          remainingAgg.unitAcquisitionCost, remainingAgg.unitMarketPrice, remainingAgg.unitSellingPrice,
          remainingAgg.requiresSeparateListing, "Some rows were split into a new proposal group", input.proposalId,
        ],
      )

      const newProposalId = generateEntityId(undefined, "tciprop")
      const movedChangeKind = movedAgg.unresolvedReason
        ? INVENTORY_PROPOSAL_CHANGE_KIND.UNRESOLVED_VARIANT
        : INVENTORY_PROPOSAL_CHANGE_KIND.NEW_HOLDING
      await manager.execute(
        `insert into trading_card_inventory_proposal
         (id, inventory_source_id, inventory_snapshot_id, baseline_snapshot_id, reconciliation_key, trading_card_variant_id,
          provider_reference, provider_reference_type, proposed_quantity, previous_quantity, quantity_delta, currency_code,
          proposed_unit_acquisition_cost, proposed_unit_market_price, proposed_unit_selling_price,
          change_kind, reconciliation_reason, review_status, requires_separate_listing)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
        [
          newProposalId, proposal.inventory_source_id, snapshotId, proposal.baseline_snapshot_id ?? null, newKey,
          movedAgg.tradingCardVariantId, movedAgg.providerReference, movedAgg.providerReferenceType, movedAgg.quantity,
          movedAgg.quantity, movedAgg.currencyCode, movedAgg.unitAcquisitionCost, movedAgg.unitMarketPrice, movedAgg.unitSellingPrice,
          movedChangeKind, "Split from an existing proposal group", movedAgg.requiresSeparateListing,
        ],
      )

      await this.writeAudit(manager, {
        ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_PROPOSAL, entityId: input.proposalId,
        action: INVENTORY_AUDIT_ACTION.PROPOSAL_SPLIT,
        oldValue: { reconciliationKey, entryCount: currentGroup.length },
        newValue: { newProposalId, newReconciliationKey: newKey, movedEntryIds: uniqueEntryIds },
      })

      return { originalProposalId: input.proposalId, newProposalId, movedEntryIds: uniqueEntryIds, alreadySplit: false }
    })
  }

  /**
   * Stage 1 Admin UX: the physical source rows currently composing one
   * proposal's group — what the split dialog and the separate-listing
   * override dialog let a reviewer choose from. Read-only; uses the exact
   * same groupKey-filter logic `splitInventoryProposal` uses to determine
   * "the group" so the two never disagree about membership.
   */
  async listCurrentGroupEntries(proposalId: string): Promise<Record<string, unknown>[]> {
    idSchema.parse(proposalId)
    const [proposal] = await this.manager_.execute<Record<string, unknown>>(
      `select id, inventory_snapshot_id, reconciliation_key from trading_card_inventory_proposal where id = ? and deleted_at is null`,
      [proposalId],
    )
    if (!proposal) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory proposal not found")
    const snapshotId = proposal.inventory_snapshot_id as string | null
    const reconciliationKey = proposal.reconciliation_key as string | null
    if (!snapshotId || !reconciliationKey) return []
    const rows = await this.manager_.execute<Record<string, unknown>>(
      `select e.*, coalesce(m.trading_card_variant_id, e.trading_card_variant_id) as effective_trading_card_variant_id,
              o.split_group_key as override_split_group_key, o.requires_separate_listing_override
       from trading_card_inventory_snapshot_entry e
       left join trading_card_inventory_snapshot_entry_match m on m.snapshot_entry_id = e.id and m.deleted_at is null
       left join trading_card_inventory_snapshot_entry_override o on o.snapshot_entry_id = e.id and o.deleted_at is null
       where e.inventory_snapshot_id = ? and e.deleted_at is null
         and (e.outcome is null or e.outcome not in ('INVALID', 'SKIPPED'))
       order by e.row_number`,
      [snapshotId],
    )
    const mapRow = (row: Record<string, unknown>): SnapshotEntryInput & { id: string } => ({
      id: row.id as string,
      providerReference: row.provider_reference as string,
      providerReferenceType: row.provider_reference_type as string,
      tradingCardVariantId: (row.effective_trading_card_variant_id ?? row.trading_card_variant_id) as string | null,
      quantity: Number(row.quantity),
      currencyCode: row.currency_code as string | null,
      unitAcquisitionCost: null, unitMarketPrice: null, unitSellingPrice: null,
      conditionCandidate: row.condition_candidate as string | null,
      finishCandidate: row.finish_candidate as string | null,
      specialTreatmentCandidate: row.special_treatment_candidate as string | null,
      requiresSeparateListing: row.requires_separate_listing_override !== null && row.requires_separate_listing_override !== undefined
        ? Boolean(row.requires_separate_listing_override) : Boolean(row.requires_separate_listing),
      splitGroupKey: (row.override_split_group_key as string | null) ?? null,
    })
    return rows.filter((row) => groupKey(mapRow(row)) === reconciliationKey)
  }

  /**
   * Stage 1: reviewer override for "does this card require a separate
   * listing?" — applied to either every currently-grouped row in a PENDING
   * proposal (`sourceEntryIds` omitted) or a specific subset of them.
   * `requires_separate_listing` is already part of the grouping identity
   * (see `reconcile.ts`'s `groupKey`), so flipping it for a subset must
   * split those rows into their own group exactly like `splitInventoryProposal`
   * does — true and false rows are never left merged together afterward.
   * Only the affected reconciliation key(s) are recomputed, never a full
   * snapshot-wide reconcile. If the resulting key already belongs to a
   * different existing PENDING proposal, this is rejected with a clear
   * error rather than silently merging two groups' aggregates together.
   */
  async setRequiresSeparateListingOverride(input: AuditContext & {
    proposalId: string; sourceEntryIds?: string[]; requiresSeparateListing: boolean
  }): Promise<{ proposalId: string; newProposalId: string | null; affectedEntryIds: string[] }> {
    idSchema.parse(input.proposalId)
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    const requestedIds = input.sourceEntryIds ? [...new Set(input.sourceEntryIds)] : null
    requestedIds?.forEach((entryId) => idSchema.parse(entryId))

    const loadGroupRows = async (manager: TxManager, snapshotId: string) => manager.execute<Record<string, unknown>>(
      `select e.*, coalesce(m.trading_card_variant_id, e.trading_card_variant_id) as effective_trading_card_variant_id,
              o.split_group_key as override_split_group_key, o.requires_separate_listing_override
       from trading_card_inventory_snapshot_entry e
       left join trading_card_inventory_snapshot_entry_match m on m.snapshot_entry_id = e.id and m.deleted_at is null
       left join trading_card_inventory_snapshot_entry_override o on o.snapshot_entry_id = e.id and o.deleted_at is null
       where e.inventory_snapshot_id = ? and e.deleted_at is null
         and (e.outcome is null or e.outcome not in ('INVALID', 'SKIPPED'))
       order by e.id`,
      [snapshotId],
    )
    const mapRow = (row: Record<string, unknown>): SnapshotEntryInput & { id: string } => ({
      id: row.id as string,
      providerReference: row.provider_reference as string,
      providerReferenceType: row.provider_reference_type as string,
      tradingCardVariantId: (row.effective_trading_card_variant_id ?? row.trading_card_variant_id) as string | null,
      quantity: Number(row.quantity),
      currencyCode: row.currency_code as string | null,
      unitAcquisitionCost: row.unit_acquisition_cost === null ? null : String(row.unit_acquisition_cost),
      unitMarketPrice: row.unit_market_price === null ? null : String(row.unit_market_price),
      unitSellingPrice: row.unit_selling_price === null ? null : String(row.unit_selling_price),
      conditionCandidate: row.condition_candidate as string | null,
      finishCandidate: row.finish_candidate as string | null,
      specialTreatmentCandidate: row.special_treatment_candidate as string | null,
      requiresSeparateListing: row.requires_separate_listing_override !== null && row.requires_separate_listing_override !== undefined
        ? Boolean(row.requires_separate_listing_override) : Boolean(row.requires_separate_listing),
      splitGroupKey: (row.override_split_group_key as string | null) ?? null,
    })

    return this.manager_.transactional(async (manager) => {
      const [proposal] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_proposal where id = ? and deleted_at is null for update`, [input.proposalId]
      )
      if (!proposal) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory proposal not found")
      if (proposal.review_status !== INVENTORY_PROPOSAL_REVIEW_STATUS.PENDING) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          `Cannot change separate-listing intent on a ${proposal.review_status} proposal — only a PENDING proposal can be changed`,
        )
      }
      const snapshotId = (proposal.inventory_snapshot_id as string | null) ?? null
      if (!snapshotId) throw new MedusaError(MedusaError.Types.INVALID_DATA, "This proposal has no snapshot")
      await this.lockAndAssertSnapshotNotDiscarded(manager, snapshotId)
      const reconciliationKey = proposal.reconciliation_key as string | null
      if (!reconciliationKey) throw new MedusaError(MedusaError.Types.INVALID_DATA, "This proposal has no grouping key")

      const allRows = (await loadGroupRows(manager, snapshotId)).map(mapRow)
      const currentGroup = allRows.filter((entry) => groupKey(entry) === reconciliationKey)
      if (currentGroup.length === 0) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "This proposal's group is currently empty")

      const targetIds = requestedIds ?? currentGroup.map((entry) => entry.id)
      const currentGroupIds = new Set(currentGroup.map((entry) => entry.id))
      const notInGroup = targetIds.filter((entryId) => !currentGroupIds.has(entryId))
      if (targetIds.length === 0 || notInGroup.length > 0) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "One or more selected rows are not part of this proposal's current group")
      }

      const targetSet = new Set(targetIds)
      const flipped = currentGroup.filter((entry) => targetSet.has(entry.id)).map((entry) => ({ ...entry, requiresSeparateListing: input.requiresSeparateListing }))
      const unchanged = currentGroup.filter((entry) => !targetSet.has(entry.id))

      const newKey = groupKey(flipped[0])
      if (newKey === reconciliationKey) {
        // Every targeted row already had this value — nothing to change.
        return { proposalId: input.proposalId, newProposalId: null, affectedEntryIds: [] }
      }

      const [collision] = await manager.execute<Record<string, unknown>>(
        `select id from trading_card_inventory_proposal
         where inventory_snapshot_id = ? and reconciliation_key = ? and review_status = 'PENDING' and deleted_at is null`,
        [snapshotId, newKey],
      )
      if (collision && collision.id !== input.proposalId) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "This change would merge with an existing group — split or resolve that group first, then retry",
        )
      }

      for (const entryId of targetIds) {
        await manager.execute(
          `insert into trading_card_inventory_snapshot_entry_override (id, snapshot_entry_id, inventory_snapshot_id, requires_separate_listing_override)
           values (?, ?, ?, ?)
           on conflict (snapshot_entry_id) where deleted_at is null
           do update set requires_separate_listing_override = excluded.requires_separate_listing_override, updated_at = now()`,
          [generateEntityId(undefined, "tciseovr"), entryId, snapshotId, input.requiresSeparateListing],
        )
      }

      let newProposalId: string | null = null
      if (unchanged.length === 0) {
        // Whole group flipped — the same proposal row simply now represents the new key.
        await manager.execute(
          `update trading_card_inventory_proposal set reconciliation_key = ?, requires_separate_listing = ?, updated_at = now() where id = ?`,
          [newKey, input.requiresSeparateListing, input.proposalId],
        )
      } else {
        const [remainingAgg] = [...aggregateSnapshotEntries(unchanged).values()]
        await manager.execute(
          `update trading_card_inventory_proposal set proposed_quantity = ?, currency_code = ?,
             proposed_unit_acquisition_cost = ?, proposed_unit_market_price = ?, proposed_unit_selling_price = ?, updated_at = now()
           where id = ?`,
          [remainingAgg.quantity, remainingAgg.currencyCode, remainingAgg.unitAcquisitionCost,
            remainingAgg.unitMarketPrice, remainingAgg.unitSellingPrice, input.proposalId],
        )
        const [flippedAgg] = [...aggregateSnapshotEntries(flipped).values()]
        newProposalId = generateEntityId(undefined, "tciprop")
        const changeKind = flippedAgg.unresolvedReason
          ? INVENTORY_PROPOSAL_CHANGE_KIND.UNRESOLVED_VARIANT
          : INVENTORY_PROPOSAL_CHANGE_KIND.NEW_HOLDING
        await manager.execute(
          `insert into trading_card_inventory_proposal
           (id, inventory_source_id, inventory_snapshot_id, baseline_snapshot_id, reconciliation_key, trading_card_variant_id,
            provider_reference, provider_reference_type, proposed_quantity, previous_quantity, quantity_delta, currency_code,
            proposed_unit_acquisition_cost, proposed_unit_market_price, proposed_unit_selling_price,
            change_kind, reconciliation_reason, review_status, requires_separate_listing)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
          [
            newProposalId, proposal.inventory_source_id, snapshotId, proposal.baseline_snapshot_id ?? null, newKey,
            flippedAgg.tradingCardVariantId, flippedAgg.providerReference, flippedAgg.providerReferenceType, flippedAgg.quantity,
            flippedAgg.quantity, flippedAgg.currencyCode, flippedAgg.unitAcquisitionCost, flippedAgg.unitMarketPrice, flippedAgg.unitSellingPrice,
            changeKind, "Separate-listing override moved rows into a new proposal group", input.requiresSeparateListing,
          ],
        )
      }

      await this.writeAudit(manager, {
        ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_PROPOSAL, entityId: input.proposalId,
        action: INVENTORY_AUDIT_ACTION.PROPOSAL_SEPARATE_LISTING_OVERRIDDEN,
        oldValue: { reconciliationKey, requiresSeparateListing: !input.requiresSeparateListing },
        newValue: { affectedEntryIds: targetIds, requiresSeparateListing: input.requiresSeparateListing, newProposalId },
      })

      return { proposalId: input.proposalId, newProposalId, affectedEntryIds: targetIds }
    })
  }

  // ---------------------------------------------------------------------
  // Inventory transaction ledger
  // ---------------------------------------------------------------------

  /** Trusts `tradingCardVariantId` has already been validated by the `appendInventoryTransactionWorkflow`. */
  async appendInventoryTransaction(input: AppendInventoryTransactionInput) {
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    const parsed = inventoryTransactionAppendSchema.parse({
      tradingCardVariantId: input.tradingCardVariantId, inventorySourceId: input.inventorySourceId ?? null,
      inventoryHoldingId: input.inventoryHoldingId ?? null, inventorySnapshotId: input.inventorySnapshotId ?? null,
      quantityBefore: input.quantityBefore, quantityAfter: input.quantityAfter, reason: input.reason,
      originatingReference: input.originatingReference ?? null, idempotencyKey: input.idempotencyKey ?? null, note: input.note ?? null,
    })
    return this.manager_.transactional(async (manager) => {
      if (parsed.idempotencyKey) {
        const [existing] = await manager.execute<Record<string, unknown>>(
          `select * from trading_card_inventory_transaction where idempotency_key = ? and deleted_at is null`, [parsed.idempotencyKey]
        )
        if (existing) return existing
      }
      const id = generateEntityId(undefined, "tcitxn")
      const delta = parsed.quantityAfter - parsed.quantityBefore
      await manager.execute(
        `insert into trading_card_inventory_transaction
         (id, trading_card_variant_id, inventory_source_id, inventory_holding_id, inventory_snapshot_id,
          quantity_before, quantity_after, quantity_delta, reason, originating_reference, actor, idempotency_key, note)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, parsed.tradingCardVariantId, parsed.inventorySourceId ?? null, parsed.inventoryHoldingId ?? null,
          parsed.inventorySnapshotId ?? null, parsed.quantityBefore, parsed.quantityAfter, delta, parsed.reason,
          parsed.originatingReference ?? null, input.actor, parsed.idempotencyKey ?? null, parsed.note ?? null,
        ]
      )
      const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_inventory_transaction where id = ?`, [id])
      return saved
    })
  }

  // ---------------------------------------------------------------------
  // Stage 5B.2: proposal review, application, and Medusa sync-state tracking
  // ---------------------------------------------------------------------

  /**
   * Bulk approve/reject. All-or-nothing: every id must currently be PENDING,
   * or the whole batch aborts with no mutation (a reviewer bulk-approving a
   * selection should never see a partial, ambiguous result). Reuses the same
   * status-flip fields `transitionInventoryProposalStatus` sets for a single
   * proposal, inlined here so the whole batch commits in one transaction.
   */
  async reviewInventoryProposals(input: ReviewInventoryProposalsInput) {
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    const parsed = proposalReviewSchema.parse({
      ids: input.ids, targetStatus: input.targetStatus,
      rejectionReason: input.rejectionReason ?? null, reviewNote: input.reviewNote ?? null,
    })
    return this.manager_.transactional(async (manager) => {
      const rows = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_proposal where id in (${parsed.ids.map(() => "?").join(", ")}) and deleted_at is null for update`,
        [...parsed.ids]
      )
      const foundIds = new Set(rows.map((row) => row.id as string))
      const missing = parsed.ids.filter((id) => !foundIds.has(id))
      if (missing.length > 0) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Inventory proposal(s) not found: ${missing.join(", ")}`)
      for (const row of rows) {
        const currentStatus = row.review_status as InventoryProposalReviewStatus
        if (currentStatus !== INVENTORY_PROPOSAL_REVIEW_STATUS.PENDING) {
          throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            `Proposal ${row.id} is ${currentStatus}, not PENDING — bulk review aborted with no changes`
          )
        }
        await this.lockAndAssertSnapshotNotDiscarded(manager, (row.inventory_snapshot_id as string | null) ?? null)
      }
      const saved: Record<string, unknown>[] = []
      for (const row of rows) {
        await manager.execute(
          `update trading_card_inventory_proposal
           set review_status = ?, resolved_by = ?, resolved_at = now(), review_note = ?, rejection_reason = ?, updated_at = now()
           where id = ?`,
          [
            parsed.targetStatus, input.actor, parsed.reviewNote ?? null,
            parsed.targetStatus === INVENTORY_PROPOSAL_REVIEW_STATUS.REJECTED ? (parsed.rejectionReason ?? null) : null,
            row.id,
          ]
        )
        await this.writeAudit(manager, {
          ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_PROPOSAL, entityId: row.id as string,
          action: INVENTORY_AUDIT_ACTION.PROPOSAL_STATUS_CHANGED,
          oldValue: { reviewStatus: row.review_status }, newValue: { reviewStatus: parsed.targetStatus },
        })
        await this.writeAudit(manager, {
          ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_PROPOSAL, entityId: row.id as string,
          action: INVENTORY_AUDIT_ACTION.PROPOSAL_REVIEWED,
          newValue: {
            targetStatus: parsed.targetStatus, reviewNote: parsed.reviewNote ?? null,
            rejectionReason: parsed.targetStatus === INVENTORY_PROPOSAL_REVIEW_STATUS.REJECTED ? (parsed.rejectionReason ?? null) : null,
          },
        })
        const [updated] = await manager.execute<Record<string, unknown>>(`select * from trading_card_inventory_proposal where id = ?`, [row.id])
        saved.push(updated)
      }
      return saved
    })
  }

  /**
   * Phase A of Stage 5B.2 apply: the atomic, authoritative local stock
   * movement for one proposal (holding upsert + ledger append + proposal
   * status flip to APPLIED), all in a single transaction — `upsertInventoryHolding`
   * and `appendInventoryTransaction` each open their own transaction and
   * cannot be composed here for atomicity, so their logic is inlined.
   *
   * Idempotency: the proposal id is the canonical domain-level idempotency
   * identity. Re-calling this on an already-APPLIED proposal is a no-op
   * success (returns the existing movement, never double-posts the ledger).
   * A caller-supplied `applicationIdempotencyKey` is only ever compared
   * against the value already stored on *this* row — it can never be used to
   * apply the same proposal twice under different keys.
   *
   * Only NEW_HOLDING/QUANTITY_CHANGE proposals are ever applied here; every
   * other `change_kind` (PRICE_CHANGE, COST_CHANGE, NO_CHANGE, UNRESOLVED_VARIANT)
   * is explicitly out of scope for this stage and rejected without mutation —
   * see `docs/decisions/0011-inventory-proposal-application-and-medusa-sync.md`.
   */
  async applyInventoryProposal(input: ApplyInventoryProposalInput): Promise<ApplyInventoryProposalItemResult> {
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    const parsed = proposalApplySchema.parse({ id: input.id, applicationIdempotencyKey: input.applicationIdempotencyKey ?? null })

    // Durable attempt record, written in its own small transaction *before*
    // Phase A begins, so "an attempt happened" survives even if Phase A
    // itself then rolls back (e.g. on a stale baseline).
    await this.manager_.transactional(async (manager) => {
      await this.writeAudit(manager, {
        ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_PROPOSAL, entityId: parsed.id,
        action: INVENTORY_AUDIT_ACTION.PROPOSAL_APPLICATION_ATTEMPTED,
      })
    })

    type PhaseAOutcome =
      | { outcome: "APPLIED"; row: Record<string, unknown> }
      | { outcome: "ALREADY_APPLIED"; row: Record<string, unknown> }
      | { outcome: "INVALID_STATE"; row: Record<string, unknown>; categoryIssue?: "MISSING" | "REMOVED" | "NOT_SYNCED" }
      | { outcome: "OUT_OF_SCOPE"; row: Record<string, unknown> }
      | { outcome: "STALE_BASELINE"; row: Record<string, unknown>; liveQuantity: number }
      | { outcome: "SNAPSHOT_DISCARDED"; row: Record<string, unknown> }

    const phaseAResult = await this.manager_.transactional(async (manager): Promise<PhaseAOutcome> => {
      const [proposal] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_proposal where id = ? and deleted_at is null for update`, [parsed.id]
      )
      if (!proposal) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory proposal not found")

      const reviewStatus = proposal.review_status as InventoryProposalReviewStatus
      if (reviewStatus === INVENTORY_PROPOSAL_REVIEW_STATUS.APPLIED) {
        return { outcome: "ALREADY_APPLIED", row: proposal }
      }
      // Locks the snapshot row (blocking a concurrent discard, and vice
      // versa — see `lockAndAssertSnapshotNotDiscarded`) before any further
      // check, so a snapshot discarded moments ago can never let this
      // request slip through and still move stock.
      const [snapshot] = await manager.execute<Record<string, unknown>>(
        `select status from trading_card_inventory_snapshot where id = ? for update`, [proposal.inventory_snapshot_id]
      )
      if (snapshot && snapshot.status === INVENTORY_SNAPSHOT_STATUS.DISCARDED) {
        return { outcome: "SNAPSHOT_DISCARDED", row: proposal }
      }
      if (reviewStatus !== INVENTORY_PROPOSAL_REVIEW_STATUS.APPROVED) {
        return { outcome: "INVALID_STATE", row: proposal }
      }

      const changeKind = proposal.change_kind as InventoryProposalChangeKind
      const inScope = changeKind === INVENTORY_PROPOSAL_CHANGE_KIND.NEW_HOLDING || changeKind === INVENTORY_PROPOSAL_CHANGE_KIND.QUANTITY_CHANGE
      if (!inScope) {
        return { outcome: "OUT_OF_SCOPE", row: proposal }
      }
      if (!proposal.trading_card_variant_id || !Number.isInteger(proposal.proposed_quantity) || (proposal.proposed_quantity as number) < 0) {
        return { outcome: "INVALID_STATE", row: proposal }
      }
      // E2B: a brand-new holding is the first Medusa-facing appearance of this
      // row's card — it must carry a reviewer-confirmed, still-active,
      // Medusa-synced eBay Store category before stock can move. This is
      // re-validated right here, inside the same locked transaction that is
      // about to move stock — never relying on the confirmation-time check
      // alone, since the category can be removed or desynced at any point
      // between confirmation and this exact moment. QUANTITY_CHANGE never
      // requires this: the underlying card/product was already categorised
      // the first time it reached NEW_HOLDING.
      if (changeKind === INVENTORY_PROPOSAL_CHANGE_KIND.NEW_HOLDING) {
        const confirmedCategoryId = proposal.confirmed_ebay_store_category_id as string | null
        if (!confirmedCategoryId) {
          return { outcome: "INVALID_STATE", row: proposal, categoryIssue: "MISSING" }
        }
        const [category] = await manager.execute<Record<string, unknown>>(
          `select status, medusa_category_id from ebay_integration_store_category where id = ? and deleted_at is null`,
          [confirmedCategoryId],
        )
        if (!category || category.status !== "ACTIVE") {
          // The confirmation is now stale — clear it so the Admin is never
          // shown a "confirmed" category that no longer exists/is active,
          // and must explicitly select and confirm another active one.
          await manager.execute(
            `update trading_card_inventory_proposal
             set confirmed_ebay_store_category_id = null, category_confirmed_at = null, category_confirmed_by = null, updated_at = now()
             where id = ?`,
            [parsed.id],
          )
          return { outcome: "INVALID_STATE", row: proposal, categoryIssue: "REMOVED" }
        }
        if (!category.medusa_category_id) {
          return { outcome: "INVALID_STATE", row: proposal, categoryIssue: "NOT_SYNCED" }
        }
      }

      const sourceId = proposal.inventory_source_id as string
      const variantId = proposal.trading_card_variant_id as string
      await manager.execute(`select pg_advisory_xact_lock(hashtextextended(?::text, 0))`, [`holding:${sourceId}:${variantId}`])

      const [holding] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_holding
         where inventory_source_id = ? and trading_card_variant_id = ? and deleted_at is null for update`,
        [sourceId, variantId]
      )
      const liveQuantity = holding ? (holding.quantity as number) : 0
      const expectedBaseline = (proposal.previous_quantity as number | null) ?? 0
      if (liveQuantity !== expectedBaseline) {
        return { outcome: "STALE_BASELINE", row: proposal, liveQuantity }
      }

      const proposedQuantity = proposal.proposed_quantity as number
      // Proposal identity is canonical. A legacy/internal caller may still
      // send an application key, but it must never select a different ledger
      // identity or collide with another proposal.
      const idempotencyKey = parsed.id

      let holdingId: string
      if (holding) {
        holdingId = holding.id as string
        await manager.execute(
          `update trading_card_inventory_holding set quantity = ?, source_observed_at = now(), updated_at = now() where id = ?`,
          [proposedQuantity, holdingId]
        )
        await this.writeAudit(manager, {
          ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_HOLDING, entityId: holdingId,
          action: INVENTORY_AUDIT_ACTION.HOLDING_QUANTITY_CHANGED,
          oldValue: { quantity: liveQuantity }, newValue: { quantity: proposedQuantity },
        })
      } else {
        holdingId = generateEntityId(undefined, "tcihold")
        await manager.execute(
          `insert into trading_card_inventory_holding
           (id, inventory_source_id, trading_card_variant_id, status, quantity, currency_code, source_observed_at)
           values (?, ?, ?, ?, ?, ?, now())`,
          [holdingId, sourceId, variantId, INVENTORY_HOLDING_STATUS.DRAFT, proposedQuantity, proposal.currency_code ?? null]
        )
        await this.writeAudit(manager, {
          ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_HOLDING, entityId: holdingId,
          action: INVENTORY_AUDIT_ACTION.HOLDING_CREATED,
          newValue: { quantity: proposedQuantity, tradingCardVariantId: variantId },
        })
      }

      const transactionId = generateEntityId(undefined, "tcitxn")
      await manager.execute(
        `insert into trading_card_inventory_transaction
         (id, trading_card_variant_id, inventory_source_id, inventory_holding_id, inventory_snapshot_id,
          quantity_before, quantity_after, quantity_delta, reason, originating_reference, actor, idempotency_key, note)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          transactionId, variantId, sourceId, holdingId, proposal.inventory_snapshot_id ?? null,
          liveQuantity, proposedQuantity, proposedQuantity - liveQuantity, INVENTORY_TRANSACTION_REASON.APPROVED_SOURCE_SNAPSHOT,
          parsed.id, input.actor, idempotencyKey, null,
        ]
      )

      await manager.execute(
        `update trading_card_inventory_proposal
         set review_status = ?, applied_at = now(), applied_transaction_id = ?, applied_holding_id = ?,
             medusa_sync_status = ?, application_idempotency_key = ?, updated_at = now()
         where id = ?`,
        [INVENTORY_PROPOSAL_REVIEW_STATUS.APPLIED, transactionId, holdingId, MEDUSA_SYNC_STATUS.PENDING, idempotencyKey, parsed.id]
      )
      await this.writeAudit(manager, {
        ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_PROPOSAL, entityId: parsed.id,
        action: INVENTORY_AUDIT_ACTION.PROPOSAL_APPLIED,
        oldValue: { quantity: liveQuantity }, newValue: { quantity: proposedQuantity, transactionId, holdingId },
      })

      const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_inventory_proposal where id = ?`, [parsed.id])
      return { outcome: "APPLIED", row: saved }
    })

    if (phaseAResult.outcome === "STALE_BASELINE") {
      await this.manager_.transactional(async (manager) => {
        await this.writeAudit(manager, {
          ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_PROPOSAL, entityId: parsed.id,
          action: INVENTORY_AUDIT_ACTION.PROPOSAL_APPLICATION_REJECTED_STALE_BASELINE,
          oldValue: { expectedBaseline: phaseAResult.row.previous_quantity }, newValue: { liveQuantity: phaseAResult.liveQuantity },
        })
      })
      return {
        proposalId: parsed.id, localApplicationStatus: "STALE_BASELINE", transactionId: null,
        priorQuantity: phaseAResult.liveQuantity, resultingQuantity: null,
        medusaSyncStatus: phaseAResult.row.medusa_sync_status as MedusaSyncStatus,
        errorCode: "STALE_BASELINE", errorMessage: "The proposal's expected baseline quantity no longer matches the current holding.",
      }
    }

    if (phaseAResult.outcome === "SNAPSHOT_DISCARDED") {
      await this.manager_.transactional(async (manager) => {
        await this.writeAudit(manager, {
          ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_PROPOSAL, entityId: parsed.id,
          action: INVENTORY_AUDIT_ACTION.PROPOSAL_APPLICATION_REJECTED_SNAPSHOT_DISCARDED,
        })
      })
      return {
        proposalId: parsed.id, localApplicationStatus: "SNAPSHOT_DISCARDED", transactionId: null,
        priorQuantity: null, resultingQuantity: null, medusaSyncStatus: MEDUSA_SYNC_STATUS.NOT_APPLICABLE,
        errorCode: "SNAPSHOT_DISCARDED",
        errorMessage: "This proposal's inventory snapshot has been discarded and can no longer be applied.",
      }
    }

    if (phaseAResult.outcome === "ALREADY_APPLIED") {
      await this.manager_.transactional(async (manager) => {
        await this.writeAudit(manager, {
          ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_PROPOSAL, entityId: parsed.id,
          action: INVENTORY_AUDIT_ACTION.PROPOSAL_APPLICATION_RETRIED,
        })
      })
      return {
        proposalId: parsed.id, localApplicationStatus: "ALREADY_APPLIED",
        transactionId: (phaseAResult.row.applied_transaction_id as string) ?? null,
        priorQuantity: null, resultingQuantity: (phaseAResult.row.proposed_quantity as number) ?? null,
        medusaSyncStatus: phaseAResult.row.medusa_sync_status as MedusaSyncStatus,
        errorCode: null, errorMessage: null,
      }
    }

    if (phaseAResult.outcome === "INVALID_STATE") {
      const isApproved = phaseAResult.row.review_status === INVENTORY_PROPOSAL_REVIEW_STATUS.APPROVED
      const categoryErrorCode: Record<"MISSING" | "REMOVED" | "NOT_SYNCED", string> = {
        MISSING: "CATEGORY_NOT_CONFIRMED",
        REMOVED: "CATEGORY_NO_LONGER_ACTIVE",
        NOT_SYNCED: "CATEGORY_NOT_SYNCED",
      }
      const categoryErrorMessage: Record<"MISSING" | "REMOVED" | "NOT_SYNCED", string> = {
        MISSING: "This proposal has no confirmed eBay Store category. Confirm or override the category before applying.",
        REMOVED: "The confirmed eBay Store category is no longer active. Select and confirm another active category before applying.",
        NOT_SYNCED: "The confirmed eBay Store category has not been synchronised to a Medusa Product Category yet. Sync categories to Medusa before applying.",
      }
      return {
        proposalId: parsed.id, localApplicationStatus: "INVALID_STATE", transactionId: null,
        priorQuantity: null, resultingQuantity: null, medusaSyncStatus: MEDUSA_SYNC_STATUS.NOT_APPLICABLE,
        errorCode: phaseAResult.categoryIssue ? categoryErrorCode[phaseAResult.categoryIssue] : "INVALID_STATE",
        errorMessage: phaseAResult.categoryIssue
          ? categoryErrorMessage[phaseAResult.categoryIssue]
          : isApproved
            ? "The approved proposal is missing a valid variant or proposed quantity."
            : `Proposal is ${phaseAResult.row.review_status}; only an APPROVED proposal can be applied.`,
      }
    }

    if (phaseAResult.outcome === "OUT_OF_SCOPE") {
      return {
        proposalId: parsed.id, localApplicationStatus: "OUT_OF_SCOPE", transactionId: null,
        priorQuantity: null, resultingQuantity: null, medusaSyncStatus: MEDUSA_SYNC_STATUS.NOT_APPLICABLE,
        errorCode: "OUT_OF_SCOPE",
        errorMessage: "This proposal's change kind is not applied by Stage 5B.2 (price/cost changes, no-change, or an unresolved variant).",
      }
    }

    return {
      proposalId: parsed.id, localApplicationStatus: "APPLIED",
      transactionId: phaseAResult.row.applied_transaction_id as string,
      priorQuantity: null, resultingQuantity: phaseAResult.row.proposed_quantity as number,
      medusaSyncStatus: phaseAResult.row.medusa_sync_status as MedusaSyncStatus,
      errorCode: null, errorMessage: null,
    }
  }

  /** Loops `applyInventoryProposal` per id — each its own transaction, so one stale/invalid proposal never blocks the others. */
  async applyInventoryProposals(input: AuditContext & { ids: string[] }): Promise<{ results: ApplyInventoryProposalItemResult[] }> {
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    const parsed = proposalApplyBatchSchema.parse({ ids: input.ids })
    const results: ApplyInventoryProposalItemResult[] = []
    for (const id of parsed.ids) {
      results.push(await this.applyInventoryProposal({ ...input, id }))
    }
    return { results }
  }

  /**
   * E2B: records the computed rule/fallback outcome for a freshly-created
   * proposal. Called once, shortly after reconciliation, from the
   * `reconcileInventorySnapshotWithPriceLocks` workflow (which has the
   * cross-module access to the ebay-integration rule engine that this
   * module itself intentionally does not). A `null` `storeCategoryId` is
   * recorded as-is — it means "no rule matched and there is no active
   * fallback", which correctly leaves the proposal with no proposed
   * category and requires a manual Admin choice.
   */
  async setProposedCategoryAssignment(input: {
    proposalId: string
    storeCategoryId: string | null
    reason: string
    ruleId: string | null
  }): Promise<void> {
    idSchema.parse(input.proposalId)
    await this.manager_.transactional(async (manager) => {
      const [proposal] = await manager.execute<Record<string, unknown>>(
        `select id from trading_card_inventory_proposal where id = ? and deleted_at is null for update`, [input.proposalId]
      )
      if (!proposal) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory proposal not found")
      await manager.execute(
        `update trading_card_inventory_proposal
         set proposed_ebay_store_category_id = ?, proposed_category_reason = ?, proposed_category_rule_id = ?, updated_at = now()
         where id = ?`,
        [input.storeCategoryId, input.reason.slice(0, 500), input.ruleId, input.proposalId]
      )
    })
  }

  /**
   * Reviewer confirmation of a proposal's eBay Store category — either
   * accepting the computed proposal or overriding it with a manual choice.
   * The caller (the admin route) is responsible for verifying `storeCategoryId`
   * is an active local Store category before calling this; this method only
   * enforces that the proposal itself is still confirmable (not yet applied).
   */
  async confirmProposalCategory(input: { proposalId: string; storeCategoryId: string; actor: string }): Promise<Record<string, unknown>> {
    idSchema.parse(input.proposalId)
    return this.manager_.transactional(async (manager) => {
      const [proposal] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_proposal where id = ? and deleted_at is null for update`, [input.proposalId]
      )
      if (!proposal) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory proposal not found")
      if (proposal.review_status === INVENTORY_PROPOSAL_REVIEW_STATUS.APPLIED) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This proposal has already been applied; its category assignment can no longer be changed.")
      }
      await manager.execute(
        `update trading_card_inventory_proposal
         set confirmed_ebay_store_category_id = ?, category_confirmed_at = now(), category_confirmed_by = ?, updated_at = now()
         where id = ?`,
        [input.storeCategoryId, input.actor, input.proposalId]
      )
      await this.writeAudit(manager, {
        actor: input.actor, source: "MANUAL", entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_PROPOSAL, entityId: input.proposalId,
        action: INVENTORY_AUDIT_ACTION.PROPOSAL_CATEGORY_CONFIRMED,
        oldValue: { confirmedStoreCategoryId: proposal.confirmed_ebay_store_category_id ?? null },
        newValue: { confirmedStoreCategoryId: input.storeCategoryId },
      })
      const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_inventory_proposal where id = ?`, [input.proposalId])
      return saved
    })
  }

  /**
   * Marks the start of a Medusa sync attempt for a locally-APPLIED proposal,
   * minting a fresh attempt token the caller must round-trip back through
   * `recordMedusaSyncResult`. Refuses (no-ops, returns the current row) if
   * the proposal isn't APPLIED, or is already SYNCED — a synced proposal
   * needs no new attempt, which is what stops the retry endpoint from
   * spawning parallel uncontrolled retries at the source.
   */
  async beginMedusaSyncAttempt(input: AuditContext & { proposalId: string }): Promise<{ proposal: Record<string, unknown>; attemptToken: string | null }> {
    idSchema.parse(input.proposalId)
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    return this.manager_.transactional(async (manager) => {
      const [proposal] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_proposal where id = ? and deleted_at is null for update`, [input.proposalId]
      )
      if (!proposal) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory proposal not found")
      if (proposal.review_status !== INVENTORY_PROPOSAL_REVIEW_STATUS.APPLIED) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Only a locally-applied proposal can be synced to Medusa")
      }
      if (proposal.medusa_sync_status === MEDUSA_SYNC_STATUS.SYNCED) {
        return { proposal, attemptToken: null }
      }
      if (proposal.medusa_sync_status === MEDUSA_SYNC_STATUS.PENDING && proposal.medusa_sync_attempt_token) {
        const attemptedAt = new Date(proposal.medusa_sync_attempted_at as string | Date).getTime()
        if (Number.isFinite(attemptedAt) && Date.now() - attemptedAt < MEDUSA_SYNC_ATTEMPT_LEASE_MS) {
          return { proposal, attemptToken: null }
        }
      }
      const attemptToken = randomUUID()
      const retryCount = proposal.medusa_sync_attempted_at ? ((proposal.medusa_sync_retry_count as number) + 1) : (proposal.medusa_sync_retry_count as number)
      await manager.execute(
        `update trading_card_inventory_proposal
         set medusa_sync_status = ?, medusa_sync_attempt_token = ?, medusa_sync_attempted_at = now(),
             medusa_sync_retry_count = ?, medusa_sync_last_error = null, updated_at = now()
         where id = ?`,
        [MEDUSA_SYNC_STATUS.PENDING, attemptToken, retryCount, input.proposalId]
      )
      if (proposal.medusa_sync_attempted_at) {
        await this.writeAudit(manager, {
          ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_PROPOSAL, entityId: input.proposalId,
          action: INVENTORY_AUDIT_ACTION.MEDUSA_SYNC_RETRIED,
          oldValue: { retryCount: proposal.medusa_sync_retry_count }, newValue: { retryCount },
        })
      }
      const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_inventory_proposal where id = ?`, [input.proposalId])
      return { proposal: saved, attemptToken }
    })
  }

  /**
   * Records the outcome of a Medusa sync attempt, guarding against stale or
   * out-of-order results: a result whose `attemptToken` no longer matches
   * the row's current token is discarded (a newer attempt has superseded
   * it); once SYNCED, a late FAILED result can never regress the status; a
   * duplicate SYNCED callback is a no-op. Never touches the ledger/holding —
   * those are already final by the time this runs.
   */
  async recordMedusaSyncResult(input: RecordMedusaSyncResultInput) {
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    const parsed = recordMedusaSyncResultSchema.parse({
      proposalId: input.proposalId, attemptToken: input.attemptToken, outcome: input.outcome,
      medusaInventoryItemId: input.medusaInventoryItemId ?? null, medusaStockLocationId: input.medusaStockLocationId ?? null,
      error: input.error ?? null,
    })
    return this.manager_.transactional(async (manager) => {
      const [proposal] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_proposal where id = ? and deleted_at is null for update`, [parsed.proposalId]
      )
      if (!proposal) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory proposal not found")
      if (proposal.review_status !== INVENTORY_PROPOSAL_REVIEW_STATUS.APPLIED) return proposal
      if (proposal.medusa_sync_attempt_token !== parsed.attemptToken) return proposal
      if (parsed.outcome === MEDUSA_SYNC_STATUS.FAILED && proposal.medusa_sync_status === MEDUSA_SYNC_STATUS.SYNCED) return proposal
      if (parsed.outcome === MEDUSA_SYNC_STATUS.SYNCED && proposal.medusa_sync_status === MEDUSA_SYNC_STATUS.SYNCED) return proposal

      if (parsed.outcome === MEDUSA_SYNC_STATUS.SYNCED) {
        await manager.execute(
          `update trading_card_inventory_proposal
           set medusa_sync_status = ?, medusa_sync_succeeded_at = now(), medusa_inventory_item_id = ?,
               medusa_stock_location_id = ?, medusa_sync_attempt_token = null, medusa_sync_last_error = null, updated_at = now()
           where id = ?`,
          [MEDUSA_SYNC_STATUS.SYNCED, parsed.medusaInventoryItemId ?? null, parsed.medusaStockLocationId ?? null, parsed.proposalId]
        )
        await this.writeAudit(manager, {
          ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_PROPOSAL, entityId: parsed.proposalId,
          action: INVENTORY_AUDIT_ACTION.MEDUSA_SYNC_SUCCEEDED,
          newValue: { medusaInventoryItemId: parsed.medusaInventoryItemId ?? null, medusaStockLocationId: parsed.medusaStockLocationId ?? null },
        })
      } else {
        await manager.execute(
          `update trading_card_inventory_proposal
           set medusa_sync_status = ?, medusa_sync_attempt_token = null, medusa_sync_last_error = ?::jsonb, updated_at = now()
           where id = ?`,
          [MEDUSA_SYNC_STATUS.FAILED, JSON.stringify({ ...parsed.error, occurredAt: new Date().toISOString() }), parsed.proposalId]
        )
        await this.writeAudit(manager, {
          ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_PROPOSAL, entityId: parsed.proposalId,
          action: INVENTORY_AUDIT_ACTION.MEDUSA_SYNC_FAILED, newValue: { error: parsed.error },
        })
      }
      const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_inventory_proposal where id = ?`, [parsed.proposalId])
      return saved
    })
  }

  // ---------------------------------------------------------------------
  // Card-creation-from-inventory-row: claim/lease + atomic resolution.
  // Mirrors beginMedusaSyncAttempt/recordMedusaSyncResult's exact protocol —
  // see the module comments on `card_creation_claim_token` in the model.
  // ---------------------------------------------------------------------

  /**
   * Marks the start of a "create a card from this unmatched row" attempt,
   * minting a fresh claim token the caller must round-trip back through
   * `resolveInventoryProposalVariant`. Refuses (no-ops, `claimToken: null`)
   * if the proposal isn't a pending, unresolved row, or if another attempt
   * already holds a live claim. If the proposal is already resolved to a
   * variant, this is the idempotent-replay case: returns that variant id
   * immediately, no claim minted, nothing to create.
   */
  async beginCardCreationClaim(input: AuditContext & { proposalId: string }): Promise<{
    claimToken: string | null; alreadyResolved: boolean; tradingCardVariantId: string | null
  }> {
    idSchema.parse(input.proposalId)
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    return this.manager_.transactional(async (manager) => {
      const [proposal] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_proposal where id = ? and deleted_at is null for update`, [input.proposalId]
      )
      if (!proposal) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory proposal not found")
      // Checked before the `review_status` gate below: a proposal this
      // workflow already resolved to a variant keeps that resolution across
      // a later, independent approve/reject of the (now NEW_HOLDING)
      // proposal — `resolveInventoryProposalVariant` only ever changes
      // `change_kind`, never `review_status`. A delayed/retried duplicate
      // request must still hit this idempotent-replay case even after the
      // reviewer has since approved or rejected it, not the "only a pending
      // proposal" error below.
      if (proposal.change_kind === INVENTORY_PROPOSAL_CHANGE_KIND.NEW_HOLDING && proposal.trading_card_variant_id) {
        return { claimToken: null, alreadyResolved: true, tradingCardVariantId: proposal.trading_card_variant_id as string }
      }
      // Locks the snapshot row (blocking a concurrent discard, and vice
      // versa) before minting a new claim — see `lockAndAssertSnapshotNotDiscarded`.
      await this.lockAndAssertSnapshotNotDiscarded(manager, (proposal.inventory_snapshot_id as string | null) ?? null)
      if (proposal.review_status !== INVENTORY_PROPOSAL_REVIEW_STATUS.PENDING) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Only a pending proposal can start card creation")
      }
      if (proposal.change_kind !== INVENTORY_PROPOSAL_CHANGE_KIND.UNRESOLVED_VARIANT) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Only an unresolved-variant proposal can start card creation")
      }
      if (proposal.card_creation_claim_token) {
        const claimedAt = new Date(proposal.card_creation_claimed_at as string | Date).getTime()
        if (Number.isFinite(claimedAt) && Date.now() - claimedAt < CARD_CREATION_CLAIM_LEASE_MS) {
          return { claimToken: null, alreadyResolved: false, tradingCardVariantId: null }
        }
      }
      const claimToken = randomUUID()
      await manager.execute(
        `update trading_card_inventory_proposal set card_creation_claim_token = ?, card_creation_claimed_at = now(), updated_at = now() where id = ?`,
        [claimToken, input.proposalId]
      )
      return { claimToken, alreadyResolved: false, tradingCardVariantId: null }
    })
  }

  /**
   * Atomically resolves an UNRESOLVED_VARIANT proposal to a real
   * TradingCardVariant, once a card has been created/found for it — the
   * final step of the create-card-from-inventory-row workflow. Requires the
   * live `card_creation_claim_token` so a superseded/expired attempt can
   * never complete after a newer one has taken ownership (see
   * `beginCardCreationClaim`). Also updates the corresponding snapshot-entry
   * match row (`matched_via = 'MANUAL'`) so a future retry-matching run
   * doesn't revert it, after verifying the match row and proposal actually
   * describe the same snapshot entry.
   */
  async resolveInventoryProposalVariant(input: AuditContext & {
    proposalId: string; claimToken: string; tradingCardVariantId: string
  }): Promise<Record<string, unknown>> {
    idSchema.parse(input.proposalId)
    idSchema.parse(input.tradingCardVariantId)
    auditContextSchema.parse({ actor: input.actor, source: input.source, reason: input.reason })
    return this.manager_.transactional(async (manager) => {
      const [proposal] = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_proposal where id = ? and deleted_at is null for update`, [input.proposalId]
      )
      if (!proposal) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory proposal not found")

      if (proposal.change_kind === INVENTORY_PROPOSAL_CHANGE_KIND.NEW_HOLDING && proposal.trading_card_variant_id) {
        if (proposal.trading_card_variant_id !== input.tradingCardVariantId) {
          throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This proposal is already resolved to a different trading card variant")
        }
        return proposal
      }
      // Locks the snapshot row (blocking a concurrent discard, and vice
      // versa) before completing resolution — see `lockAndAssertSnapshotNotDiscarded`.
      await this.lockAndAssertSnapshotNotDiscarded(manager, (proposal.inventory_snapshot_id as string | null) ?? null)
      if (proposal.change_kind !== INVENTORY_PROPOSAL_CHANGE_KIND.UNRESOLVED_VARIANT || proposal.review_status !== INVENTORY_PROPOSAL_REVIEW_STATUS.PENDING) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Only a pending, unresolved-variant proposal can be resolved this way")
      }
      if (proposal.card_creation_claim_token !== input.claimToken) {
        throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This card-creation attempt's claim is stale — a newer attempt has taken ownership of this proposal")
      }

      const [matchRow] = await manager.execute<Record<string, unknown>>(
        `select m.* from trading_card_inventory_snapshot_entry_match m
         join trading_card_inventory_snapshot_entry e on e.id = m.snapshot_entry_id
         where e.inventory_snapshot_id = ? and e.provider_reference = ? and m.deleted_at is null and e.deleted_at is null
         for update of m`,
        [proposal.inventory_snapshot_id, proposal.provider_reference]
      )
      if (!matchRow) {
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "No matching snapshot entry was found for this proposal's provider reference")
      }

      await manager.execute(
        `update trading_card_inventory_proposal
         set trading_card_variant_id = ?, change_kind = ?, card_creation_claim_token = null, card_creation_claimed_at = null, updated_at = now()
         where id = ?`,
        [input.tradingCardVariantId, INVENTORY_PROPOSAL_CHANGE_KIND.NEW_HOLDING, input.proposalId]
      )
      await manager.execute(
        `update trading_card_inventory_snapshot_entry_match
         set matching_status = ?, trading_card_variant_id = ?, matched_via = ?, updated_at = now()
         where id = ?`,
        [INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS.MATCHED, input.tradingCardVariantId, INVENTORY_SNAPSHOT_ENTRY_MATCHED_VIA.MANUAL, matchRow.id]
      )
      await this.writeAudit(manager, {
        ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_PROPOSAL, entityId: input.proposalId,
        action: INVENTORY_AUDIT_ACTION.PROPOSAL_VARIANT_RESOLVED,
        oldValue: { changeKind: proposal.change_kind }, newValue: { changeKind: INVENTORY_PROPOSAL_CHANGE_KIND.NEW_HOLDING, tradingCardVariantId: input.tradingCardVariantId },
      })
      const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_inventory_proposal where id = ?`, [input.proposalId])
      return saved
    })
  }
}

export default TradingCardInventoryModuleService
