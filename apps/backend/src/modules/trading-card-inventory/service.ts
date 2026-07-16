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
import { normalizeSourceName } from "./identity/normalize-source-name"
import { reconcileSnapshots, type SnapshotEntryInput } from "./reconciliation/reconcile"
import { canonicalDecimal } from "./reconciliation/decimal"
import {
  auditContextSchema, createInventorySourceSchema, renameInventorySourceSchema, inventoryHoldingUpsertSchema,
  holdingStatusSchema, inventoryProposalCreateSchema, inventoryTransactionAppendSchema, idSchema,
} from "./validation"
import {
  INVENTORY_AUDIT_ACTION, INVENTORY_AUDIT_ENTITY_TYPE, INVENTORY_HOLDING_STATUS,
  INVENTORY_PROPOSAL_REVIEW_STATUS, INVENTORY_PROVIDER_REFERENCE_TYPE, INVENTORY_SNAPSHOT_STATUS, INVENTORY_SOURCE_STATUS,
  INVENTORY_SNAPSHOT_ENTRY_OUTCOME, INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS, INVENTORY_SNAPSHOT_ENTRY_MATCHED_VIA,
  isValidInventoryHoldingTransition, isValidInventoryProposalTransition, isValidInventorySnapshotTransition,
  type InventoryHoldingStatus, type InventoryProposalReviewStatus, type InventoryRecordSource, type InventorySnapshotStatus,
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
  finishCandidate?: string | null
  specialTreatmentCandidate?: string | null
  rarityCandidate?: string | null
  rarityRaw?: string | null
  languageConflict: boolean
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

class TradingCardInventoryModuleService extends MedusaService({
  InventorySource, InventorySnapshot, InventorySnapshotEntry, InventorySnapshotEntryMatch, InventorySnapshotEntryDiagnostic,
  InventoryHolding, InventoryProposal, InventoryTransaction, InventoryAuditEntry,
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
        `select id from trading_card_inventory_source where id = ? and deleted_at is null for update`, [input.inventorySourceId]
      )
      if (!source) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Inventory source not found")
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
      if (snapshot.status !== INVENTORY_SNAPSHOT_STATUS.DRAFT) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Imported rows can only be added while the snapshot is DRAFT")
      }
      const entryIds: string[] = []
      for (let offset = 0; offset < input.rows.length; offset += 500) {
        const chunk = input.rows.slice(offset, offset + 500)
        const chunkIds = chunk.map(() => generateEntityId(undefined, "tcisentry"))
        entryIds.push(...chunkIds)
        const placeholders = chunk.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)`).join(", ")
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
            row.finishCandidate ?? null, row.specialTreatmentCandidate ?? null, row.rarityCandidate ?? null,
            row.rarityRaw ?? null, row.languageConflict, row.rawFields ? JSON.stringify(row.rawFields) : null,
          ]
        })
        await manager.execute(
          `insert into trading_card_inventory_snapshot_entry
           (id, inventory_snapshot_id, provider_reference, provider_reference_type, trading_card_variant_id, quantity,
            currency_code, unit_acquisition_cost, unit_market_price, unit_selling_price, row_number, outcome,
            condition_source, finish_candidate, special_treatment_candidate, rarity_candidate, rarity_raw,
            language_conflict, raw_fields) values ${placeholders}`,
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

  /** Stage 5B.1: writes or re-writes matching results for one entry. Create-or-update — the only writer of `InventorySnapshotEntryMatch`. Appends new MATCHING diagnostics rather than replacing prior ones. */
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
      if (input.matchingStatus === INVENTORY_SNAPSHOT_ENTRY_MATCHING_STATUS.MATCHED && variantId) {
        await manager.execute(
          `update trading_card_inventory_snapshot_entry set trading_card_variant_id = ? where id = ?`,
          [variantId, input.snapshotEntryId],
        )
      }
      for (const diagnostic of input.diagnostics) {
        await manager.execute(
          `insert into trading_card_inventory_snapshot_entry_diagnostic
           (id, snapshot_entry_id, inventory_snapshot_id, row_number, phase, code, severity, field_ref, message)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            generateEntityId(undefined, "tcisediag"), input.snapshotEntryId, input.inventorySnapshotId, diagnostic.rowNumber,
            diagnostic.phase, diagnostic.code, diagnostic.severity, diagnostic.fieldRef ?? null, diagnostic.message,
          ],
        )
      }
      const [saved] = await manager.execute<Record<string, unknown>>(`select * from trading_card_inventory_snapshot_entry_match where id = ?`, [matchId])
      return saved
    })
  }

  /** Stage 5B.1: aggregate row/diagnostic/matching counts for the Admin preview screen — computed live, never stored redundantly. */
  async getSnapshotImportSummary(snapshotId: string) {
    idSchema.parse(snapshotId)
    const [snapshot] = await this.manager_.execute<Record<string, unknown>>(
      `select id, inventory_source_id, status, original_filename, content_hash, row_count
       from trading_card_inventory_snapshot where id = ? and deleted_at is null`, [snapshotId]
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
    return {
      snapshotId: snapshot.id, inventorySourceId: snapshot.inventory_source_id, status: snapshot.status,
      originalFilename: snapshot.original_filename, contentHash: snapshot.content_hash, rowCount: snapshot.row_count,
      byOutcome: Object.fromEntries(byOutcome.map((row) => [row.key, Number(row.count)])),
      byMatchingStatus: Object.fromEntries(byMatchingStatus.map((row) => [row.key, Number(row.count)])),
      byDiagnosticSeverity: Object.fromEntries(byDiagnosticSeverity.map((row) => [row.key, Number(row.count)])),
      uniqueProviderReferences: Number(unique_references), duplicateRowCount: Number(duplicate_rows),
    }
  }

  /** Stage 5B.1: paginated, filterable entry listing for the Admin preview screen. */
  async listSnapshotEntriesForAdmin(snapshotId: string, filters: { outcome?: string; matchingStatus?: string }, pagination: { limit: number; offset: number }) {
    idSchema.parse(snapshotId)
    const conditions = ["e.inventory_snapshot_id = ?", "e.deleted_at is null"]
    const params: unknown[] = [snapshotId]
    if (filters.outcome) { conditions.push("e.outcome = ?"); params.push(filters.outcome) }
    if (filters.matchingStatus) { conditions.push("m.matching_status = ?"); params.push(filters.matchingStatus) }
    const where = conditions.join(" and ")
    const [{ count }] = await this.manager_.execute<{ count: string }>(
      `select count(*)::text as count from trading_card_inventory_snapshot_entry e
       left join trading_card_inventory_snapshot_entry_match m on m.snapshot_entry_id = e.id and m.deleted_at is null
       where ${where}`, params,
    )
    const rows = await this.manager_.execute<Record<string, unknown>>(
      `select e.*, m.matching_status, m.matched_via, m.retry_count from trading_card_inventory_snapshot_entry e
       left join trading_card_inventory_snapshot_entry_match m on m.snapshot_entry_id = e.id and m.deleted_at is null
       where ${where} order by e.row_number asc nulls last limit ? offset ?`,
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
        if ((snapshot.reconciled_against_snapshot_id ?? null) !== (input.previousApprovedSnapshotId ?? null)) {
          throw new MedusaError(MedusaError.Types.INVALID_DATA, "Snapshot was already reconciled against a different baseline")
        }
        return this.getReconciliationSummaryWithManager(manager, input.snapshotId)
      }
      if (snapshot.status !== INVENTORY_SNAPSHOT_STATUS.VALIDATED) {
        throw new MedusaError(MedusaError.Types.INVALID_DATA, "Only a VALIDATED snapshot can be reconciled")
      }

      let baseline: Record<string, unknown> | undefined
      if (input.previousApprovedSnapshotId) {
        ;[baseline] = await manager.execute<Record<string, unknown>>(
          `select * from trading_card_inventory_snapshot
           where id = ? and inventory_source_id = ? and approved_at is not null and status not in ('REJECTED', 'FAILED')
             and deleted_at is null for share`,
          [input.previousApprovedSnapshotId, input.inventorySourceId],
        )
        if (!baseline) throw new MedusaError(MedusaError.Types.INVALID_DATA, "The reconciliation baseline must be an approved snapshot for this source")
        if (Number(baseline.sequence_number) >= Number(snapshot.sequence_number)) {
          throw new MedusaError(MedusaError.Types.INVALID_DATA, "The reconciliation baseline must precede the new snapshot")
        }
      }

      const currentRows = await manager.execute<Record<string, unknown>>(
        `select * from trading_card_inventory_snapshot_entry where inventory_snapshot_id = ? and deleted_at is null order by id`, [input.snapshotId]
      )
      const previousRows = input.previousApprovedSnapshotId
        ? await manager.execute<Record<string, unknown>>(
          `select * from trading_card_inventory_snapshot_entry where inventory_snapshot_id = ? and deleted_at is null order by id`,
          [input.previousApprovedSnapshotId],
        ) : []
      const mapEntry = (row: Record<string, unknown>): SnapshotEntryInput => ({
        providerReference: row.provider_reference as string,
        providerReferenceType: row.provider_reference_type as string,
        tradingCardVariantId: row.trading_card_variant_id as string | null,
        quantity: Number(row.quantity), currencyCode: row.currency_code as string | null,
        unitAcquisitionCost: row.unit_acquisition_cost === null ? null : String(row.unit_acquisition_cost),
        unitMarketPrice: row.unit_market_price === null ? null : String(row.unit_market_price),
        unitSellingPrice: row.unit_selling_price === null ? null : String(row.unit_selling_price),
      })
      const proposals = reconcileSnapshots({ previous: previousRows.map(mapEntry), current: currentRows.map(mapEntry), priceLockedVariantIds: lockedIds })
      for (let offset = 0; offset < proposals.length; offset += 250) {
        const chunk = proposals.slice(offset, offset + 250)
        const placeholders = chunk.map(() => `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, 'PENDING')`).join(", ")
        const params = chunk.flatMap((proposal) => [
          generateEntityId(undefined, "tciprop"), input.inventorySourceId, input.snapshotId,
          input.previousApprovedSnapshotId ?? null, proposal.reconciliationKey, proposal.tradingCardVariantId,
          proposal.providerReference, proposal.providerReferenceType, proposal.proposedQuantity, proposal.previousQuantity,
          proposal.quantityDelta, proposal.currencyCode, proposal.proposedUnitAcquisitionCost, proposal.previousUnitAcquisitionCost,
          proposal.proposedUnitMarketPrice, proposal.previousUnitMarketPrice, proposal.proposedUnitSellingPrice,
          proposal.previousUnitSellingPrice, proposal.changeKind, proposal.reason,
          JSON.stringify({ changedFields: proposal.changedFields.slice(0, 8), duplicateRowCount: proposal.duplicateRowCount, sellingPriceLocked: proposal.sellingPriceLocked }),
          comparedAt,
        ])
        await manager.execute(
          `insert into trading_card_inventory_proposal
           (id, inventory_source_id, inventory_snapshot_id, baseline_snapshot_id, reconciliation_key, trading_card_variant_id,
            provider_reference, provider_reference_type, proposed_quantity, previous_quantity, quantity_delta, currency_code,
            proposed_unit_acquisition_cost, previous_unit_acquisition_cost, proposed_unit_market_price, previous_unit_market_price,
            proposed_unit_selling_price, previous_unit_selling_price, change_kind, reconciliation_reason,
            reconciliation_diagnostics, compared_at, review_status) values ${placeholders}`,
          params,
        )
      }
      await manager.execute(
        `update trading_card_inventory_snapshot set status = ?, reconciled_against_snapshot_id = ?, reconciled_at = ?, updated_at = now() where id = ?`,
        [INVENTORY_SNAPSHOT_STATUS.PENDING_REVIEW, input.previousApprovedSnapshotId ?? null, comparedAt, input.snapshotId],
      )
      await this.writeAudit(manager, {
        ...input, entityType: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_SNAPSHOT, entityId: input.snapshotId,
        action: INVENTORY_AUDIT_ACTION.SNAPSHOT_RECONCILED,
        oldValue: { status: INVENTORY_SNAPSHOT_STATUS.VALIDATED },
        newValue: { status: INVENTORY_SNAPSHOT_STATUS.PENDING_REVIEW, baselineSnapshotId: input.previousApprovedSnapshotId ?? null, proposalCount: proposals.length },
      })
      return this.getReconciliationSummaryWithManager(manager, input.snapshotId)
    })
  }

  async listSnapshotVariantIds(snapshotIds: string[]) {
    if (snapshotIds.length === 0 || snapshotIds.length > 2) return []
    snapshotIds.forEach((id) => idSchema.parse(id))
    const placeholders = snapshotIds.map(() => "?").join(", ")
    const rows = await this.manager_.execute<{ trading_card_variant_id: string }>(
      `select distinct trading_card_variant_id from trading_card_inventory_snapshot_entry
       where inventory_snapshot_id in (${placeholders}) and trading_card_variant_id is not null and deleted_at is null
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
}

export default TradingCardInventoryModuleService
