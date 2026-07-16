import { generateEntityId, MedusaError, MedusaService } from "@medusajs/framework/utils"
import InventorySource from "./models/inventory-source"
import InventorySnapshot from "./models/inventory-snapshot"
import InventoryHolding from "./models/inventory-holding"
import InventoryProposal from "./models/inventory-proposal"
import InventoryTransaction from "./models/inventory-transaction"
import InventoryAuditEntry from "./models/inventory-audit-entry"
import { normalizeSourceName } from "./identity/normalize-source-name"
import {
  auditContextSchema, createInventorySourceSchema, renameInventorySourceSchema, inventoryHoldingUpsertSchema,
  holdingStatusSchema, inventoryProposalCreateSchema, inventoryTransactionAppendSchema, idSchema,
} from "./validation"
import {
  INVENTORY_AUDIT_ACTION, INVENTORY_AUDIT_ENTITY_TYPE, INVENTORY_HOLDING_STATUS,
  INVENTORY_PROPOSAL_REVIEW_STATUS, INVENTORY_SNAPSHOT_STATUS, INVENTORY_SOURCE_STATUS,
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

class TradingCardInventoryModuleService extends MedusaService({
  InventorySource, InventorySnapshot, InventoryHolding, InventoryProposal, InventoryTransaction, InventoryAuditEntry,
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
