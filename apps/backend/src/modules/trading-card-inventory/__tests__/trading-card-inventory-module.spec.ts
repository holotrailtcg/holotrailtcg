import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection } from "@medusajs/framework/utils"
import { TRADING_CARD_INVENTORY_MODULE } from "../index"

let pgConnection: ReturnType<typeof createPgConnection>
let rootConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let service: any

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

beforeAll(async () => {
  rootConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  pgConnection = await rootConnection.transaction() as never
  medusaApp = await MedusaApp({
    modulesConfig: { [TRADING_CARD_INVENTORY_MODULE]: { resolve: "./src/modules/trading-card-inventory" } },
    injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection },
    cwd: process.cwd(),
  })
  await medusaApp.onApplicationStart()
  service = medusaApp.modules[TRADING_CARD_INVENTORY_MODULE]
}, 60000)

afterAll(async () => {
  await medusaApp?.onApplicationPrepareShutdown()
  await medusaApp?.onApplicationShutdown()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (pgConnection as any)?.rollback()
  await rootConnection?.destroy()
})

async function createSource(overrides: Record<string, unknown> = {}) {
  const id = suffix()
  return service.createInventorySource({
    displayName: `Test Source ${id}`, provider: "PULSE", language: "EN", actor: "test-actor", source: "MANUAL", ...overrides,
  })
}

describe("trading-card-inventory schema", () => {
  it("resolves all seven model services", () => {
    expect(typeof service.createInventorySources).toBe("function")
    expect(typeof service.createInventorySnapshots).toBe("function")
    expect(typeof service.listInventorySnapshotEntries).toBe("function")
    expect(typeof service.createInventoryHoldings).toBe("function")
    expect(typeof service.createInventoryProposals).toBe("function")
    expect(typeof service.listInventoryTransactions).toBe("function")
    expect(typeof service.listInventoryAuditEntries).toBe("function")
  })

  it("keeps the transaction ledger append-only through the public module service", async () => {
    await expect(service.createInventoryTransactions()).rejects.toThrow("append-only")
    await expect(service.updateInventoryTransactions()).rejects.toThrow("append-only")
    await expect(service.deleteInventoryTransactions()).rejects.toThrow()
    await expect(service.softDeleteInventoryTransactions()).rejects.toThrow()
    await expect(service.restoreInventoryTransactions()).rejects.toThrow()
  })

  it("keeps audit entries append-only through the public module service", async () => {
    await expect(service.updateInventoryAuditEntries()).rejects.toThrow("append-only")
    await expect(service.deleteInventoryAuditEntries()).rejects.toThrow("cannot be deleted")
    await expect(service.softDeleteInventoryAuditEntries()).rejects.toThrow("cannot be deleted")
    await expect(service.restoreInventoryAuditEntries()).rejects.toThrow("cannot be restored")
  })
})

describe("snapshot reconciliation", () => {
  async function snapshotWithRows(sourceId: string, rows: Array<Record<string, unknown>>) {
    const snapshot = await service.createInventorySnapshot({ inventorySourceId: sourceId, actor: "test-actor", source: "MANUAL" })
    await service.addInventorySnapshotEntries({ snapshotId: snapshot.id, entries: rows, actor: "test-actor", source: "MANUAL" })
    await service.transitionInventorySnapshotStatus({ id: snapshot.id, targetStatus: "VALIDATED", actor: "test-actor", source: "MANUAL" })
    return snapshot
  }

  const entry = (reference: string, overrides: Record<string, unknown> = {}) => ({
    providerReference: reference, providerReferenceType: "PULSE_PRODUCT_ID", tradingCardVariantId: `tcvar_${reference}`,
    quantity: 1, currencyCode: "GBP", unitAcquisitionCost: "1.00", unitMarketPrice: "2.00", unitSellingPrice: "3.00",
    ...overrides,
  })

  it("persists grouped draft proposals, exact diagnostics, and missing-to-zero changes", async () => {
    const source = await createSource()
    const baseline = await snapshotWithRows(source.id, [entry("duplicate"), entry("duplicate", { quantity: 3, unitAcquisitionCost: "2.00" }), entry("missing", { quantity: 4 })])
    await service.transitionInventorySnapshotStatus({ id: baseline.id, targetStatus: "PENDING_REVIEW", actor: "reviewer", source: "MANUAL" })
    await service.transitionInventorySnapshotStatus({ id: baseline.id, targetStatus: "APPROVED", actor: "reviewer", source: "MANUAL" })
    const current = await snapshotWithRows(source.id, [entry("duplicate", { quantity: 5, unitAcquisitionCost: "2.00" }), entry("new"), entry("unresolved", { tradingCardVariantId: null })])
    const summary = await service.reconcileInventorySnapshot({
      inventorySourceId: source.id, snapshotId: current.id, previousApprovedSnapshotId: baseline.id,
      actor: "reconciler", source: "SYSTEM", comparedAt: new Date("2026-07-16T12:00:00.000Z"),
    })
    expect(summary).toMatchObject({ status: "PENDING_REVIEW", proposalCount: 4, baselineSnapshotId: baseline.id })
    const proposals = await service.listInventoryProposals({ inventory_snapshot_id: current.id })
    expect(proposals.every((proposal: Record<string, unknown>) => proposal.review_status === "PENDING")).toBe(true)
    const missing = proposals.find((proposal: Record<string, unknown>) => proposal.provider_reference === "missing")
    expect(missing).toMatchObject({ previous_quantity: 4, proposed_quantity: 0, quantity_delta: -4, change_kind: "QUANTITY_CHANGE" })
    const duplicate = proposals.find((proposal: Record<string, unknown>) => proposal.provider_reference === "duplicate")
    expect(duplicate.reconciliation_diagnostics).toMatchObject({ duplicateRowCount: 1 })
  }, 30000)

  it("is idempotent and serialises concurrent attempts without duplicate proposals", async () => {
    const source = await createSource()
    const current = await snapshotWithRows(source.id, [entry(`concurrent-${suffix()}`)])
    const attempts = await Promise.all(Array.from({ length: 4 }, () => service.reconcileInventorySnapshot({
      inventorySourceId: source.id, snapshotId: current.id, actor: "reconciler", source: "SYSTEM",
    })))
    expect(new Set(attempts.map((result: Record<string, unknown>) => result.proposalCount))).toEqual(new Set([1]))
    const [, count] = await service.listAndCountInventoryProposals({ inventory_snapshot_id: current.id })
    expect(count).toBe(1)
  }, 30000)

  it("rejects invalid baselines and rolls back all writes", async () => {
    const source = await createSource()
    const rejected = await snapshotWithRows(source.id, [entry("old")])
    await service.transitionInventorySnapshotStatus({ id: rejected.id, targetStatus: "PENDING_REVIEW", actor: "reviewer", source: "MANUAL" })
    await service.transitionInventorySnapshotStatus({ id: rejected.id, targetStatus: "REJECTED", actor: "reviewer", source: "MANUAL" })
    const current = await snapshotWithRows(source.id, [entry("new")])
    await expect(service.reconcileInventorySnapshot({
      inventorySourceId: source.id, snapshotId: current.id, previousApprovedSnapshotId: rejected.id,
      actor: "reconciler", source: "SYSTEM",
    })).rejects.toThrow(/approved snapshot/)
    const refreshed = await service.retrieveInventorySnapshot(current.id)
    expect(refreshed.status).toBe("VALIDATED")
    const [, count] = await service.listAndCountInventoryProposals({ inventory_snapshot_id: current.id })
    expect(count).toBe(0)
  }, 30000)

  it("automatically chooses the latest eligible approved baseline and skips superseded snapshots", async () => {
    const source = await createSource()
    const approve = async (snapshot: Record<string, unknown>) => {
      await service.transitionInventorySnapshotStatus({ id: snapshot.id, targetStatus: "PENDING_REVIEW", actor: "reviewer", source: "MANUAL" })
      await service.transitionInventorySnapshotStatus({ id: snapshot.id, targetStatus: "APPROVED", actor: "reviewer", source: "MANUAL" })
    }
    const first = await snapshotWithRows(source.id, [entry(`first-${suffix()}`)])
    await approve(first)
    const second = await snapshotWithRows(source.id, [entry(`second-${suffix()}`)])
    await approve(second)

    const current = await snapshotWithRows(source.id, [entry(`current-${suffix()}`)])
    const latestSummary = await service.reconcileInventorySnapshot({
      inventorySourceId: source.id, snapshotId: current.id, actor: "reconciler", source: "SYSTEM",
    })
    expect(latestSummary.baselineSnapshotId).toBe(second.id)

    await service.transitionInventorySnapshotStatus({ id: second.id, targetStatus: "SUPERSEDED", actor: "reviewer", source: "MANUAL" })
    const next = await snapshotWithRows(source.id, [entry(`next-${suffix()}`)])
    const fallbackSummary = await service.reconcileInventorySnapshot({
      inventorySourceId: source.id, snapshotId: next.id, actor: "reconciler", source: "SYSTEM",
    })
    expect(fallbackSummary.baselineSnapshotId).toBe(first.id)
  }, 30000)
})

describe("inventory source", () => {
  it("creates a source and records an audit entry", async () => {
    const source = await createSource()
    expect(source.status).toBe("ACTIVE")
    const entries = await service.listInventoryAuditEntries({ entity_type: "INVENTORY_SOURCE", entity_id: source.id })
    expect(entries.some((entry: Record<string, unknown>) => entry.action === "SOURCE_CREATED")).toBe(true)
  })

  it("rejects a duplicate name under normalised comparison", async () => {
    const id = suffix()
    await service.createInventorySource({ displayName: `  [ME]  eBay Stock ${id}  `, provider: "PULSE", language: "EN", actor: "test-actor", source: "MANUAL" })
    await expect(service.createInventorySource({
      displayName: `[me] ebay   stock ${id}`, provider: "PULSE", language: "EN", actor: "test-actor", source: "MANUAL",
    })).rejects.toThrow()
  })

  it("allows renaming to a genuinely different name and rejects renaming onto an existing one", async () => {
    const a = await createSource()
    const b = await createSource()
    const renamed = await service.renameInventorySource({ id: a.id, displayName: `Renamed ${suffix()}`, actor: "test-actor", source: "MANUAL" })
    expect(renamed.displayName ?? renamed.display_name).toContain("Renamed")
    await expect(service.renameInventorySource({
      id: a.id, displayName: b.displayName ?? b.display_name, actor: "test-actor", source: "MANUAL",
    })).rejects.toThrow()
  })

  it("archives and restores a source", async () => {
    const source = await createSource()
    const archived = await service.archiveInventorySource({ id: source.id, actor: "test-actor", source: "MANUAL" })
    expect(archived.status).toBe("ARCHIVED")
    const restored = await service.restoreInventorySource({ id: source.id, actor: "test-actor", source: "MANUAL" })
    expect(restored.status).toBe("ACTIVE")
  })

  it("enforces the currency-format check constraint", async () => {
    await expect(createSource({ defaultCurrencyCode: "gbp" })).rejects.toThrow()
  })
})

describe("inventory snapshot lifecycle", () => {
  it("creates a snapshot in DRAFT with an auto-assigned sequence number", async () => {
    const source = await createSource()
    const first = await service.createInventorySnapshot({ inventorySourceId: source.id, actor: "test-actor", source: "MANUAL" })
    const second = await service.createInventorySnapshot({ inventorySourceId: source.id, actor: "test-actor", source: "MANUAL" })
    expect(first.status).toBe("DRAFT")
    expect(second.sequence_number).toBe(first.sequence_number + 1)
  })

  it("follows the validated transition path and rejects skipping states", async () => {
    const source = await createSource()
    const snapshot = await service.createInventorySnapshot({ inventorySourceId: source.id, actor: "test-actor", source: "MANUAL" })
    await expect(service.transitionInventorySnapshotStatus({
      id: snapshot.id, targetStatus: "APPROVED", actor: "test-actor", source: "MANUAL",
    })).rejects.toThrow()
    const validated = await service.transitionInventorySnapshotStatus({ id: snapshot.id, targetStatus: "VALIDATED", actor: "test-actor", source: "MANUAL" })
    expect(validated.status).toBe("VALIDATED")
  })

  it("prevents two concurrently APPLYING snapshots for the same source", async () => {
    const source = await createSource()
    const a = await service.createInventorySnapshot({ inventorySourceId: source.id, actor: "test-actor", source: "MANUAL" })
    const b = await service.createInventorySnapshot({ inventorySourceId: source.id, actor: "test-actor", source: "MANUAL" })
    for (const snap of [a, b]) {
      await service.transitionInventorySnapshotStatus({ id: snap.id, targetStatus: "VALIDATED", actor: "test-actor", source: "MANUAL" })
      await service.transitionInventorySnapshotStatus({ id: snap.id, targetStatus: "PENDING_REVIEW", actor: "test-actor", source: "MANUAL" })
      await service.transitionInventorySnapshotStatus({ id: snap.id, targetStatus: "APPROVED", actor: "test-actor", source: "MANUAL" })
    }
    await service.transitionInventorySnapshotStatus({ id: a.id, targetStatus: "APPLYING", actor: "test-actor", source: "MANUAL" })
    await expect(service.transitionInventorySnapshotStatus({
      id: b.id, targetStatus: "APPLYING", actor: "test-actor", source: "MANUAL",
    })).rejects.toThrow()
  })

  it("rejects a duplicate live content hash for the same source but allows it after rejection", async () => {
    const source = await createSource()
    const hash = `hash_${suffix()}`
    const first = await service.createInventorySnapshot({ inventorySourceId: source.id, contentHash: hash, actor: "test-actor", source: "MANUAL" })
    await expect(service.createInventorySnapshot({
      inventorySourceId: source.id, contentHash: hash, actor: "test-actor", source: "MANUAL",
    })).rejects.toThrow()
    await service.transitionInventorySnapshotStatus({ id: first.id, targetStatus: "VALIDATED", actor: "test-actor", source: "MANUAL" })
    await service.transitionInventorySnapshotStatus({ id: first.id, targetStatus: "PENDING_REVIEW", actor: "test-actor", source: "MANUAL" })
    await service.transitionInventorySnapshotStatus({ id: first.id, targetStatus: "REJECTED", actor: "test-actor", source: "MANUAL", rejectionReason: "bad file" })
    const retried = await service.createInventorySnapshot({ inventorySourceId: source.id, contentHash: hash, actor: "test-actor", source: "MANUAL" })
    expect(retried.id).not.toBe(first.id)
  })
})

describe("inventory holding", () => {
  it("creates a holding in DRAFT and enforces non-negative quantity", async () => {
    const source = await createSource()
    const variantId = `tcvar_${suffix()}`
    const holding = await service.upsertInventoryHolding({
      inventorySourceId: source.id, tradingCardVariantId: variantId, quantity: 4, actor: "test-actor", source: "MANUAL",
    })
    expect(holding.status).toBe("DRAFT")
    expect(holding.quantity).toBe(4)
    await expect(service.createInventoryHoldings({
      inventory_source_id: source.id, trading_card_variant_id: `tcvar_${suffix()}`, quantity: -1,
    })).rejects.toThrow()
  })

  it("upserts in place for the same source/variant pair rather than duplicating", async () => {
    const source = await createSource()
    const variantId = `tcvar_${suffix()}`
    const first = await service.upsertInventoryHolding({
      inventorySourceId: source.id, tradingCardVariantId: variantId, quantity: 2, actor: "test-actor", source: "MANUAL",
    })
    const second = await service.upsertInventoryHolding({
      inventorySourceId: source.id, tradingCardVariantId: variantId, quantity: 7, actor: "test-actor", source: "MANUAL",
    })
    expect(second.id).toBe(first.id)
    expect(second.quantity).toBe(7)
  })

  it("requires a currency when a money amount is present", async () => {
    const source = await createSource()
    await expect(service.upsertInventoryHolding({
      inventorySourceId: source.id, tradingCardVariantId: `tcvar_${suffix()}`, quantity: 1,
      unitSellingPrice: 2.5, actor: "test-actor", source: "MANUAL",
    })).rejects.toThrow()
  })

  it("follows the validated holding-status transition path", async () => {
    const source = await createSource()
    const holding = await service.upsertInventoryHolding({
      inventorySourceId: source.id, tradingCardVariantId: `tcvar_${suffix()}`, quantity: 1, actor: "test-actor", source: "MANUAL",
    })
    await expect(service.transitionInventoryHoldingStatus({
      id: holding.id, targetStatus: "ARCHIVED", actor: "test-actor", source: "MANUAL",
    })).resolves.toMatchObject({ status: "ARCHIVED" })
    const restored = await service.transitionInventoryHoldingStatus({ id: holding.id, targetStatus: "READY", actor: "test-actor", source: "MANUAL" })
    expect(restored.status).toBe("READY")
    // Archiving/restoring never touches quantity.
    expect(restored.quantity).toBe(1)
  })

  it("resolves concurrent upserts for the same source/variant pair without creating duplicates", async () => {
    const source = await createSource()
    const variantId = `tcvar_${suffix()}`
    const results = await Promise.all(Array.from({ length: 5 }, (_, index) => service.upsertInventoryHolding({
      inventorySourceId: source.id, tradingCardVariantId: variantId, quantity: index + 1, actor: "test-actor", source: "MANUAL",
    })))
    const distinctIds = new Set(results.map((row: Record<string, unknown>) => row.id))
    expect(distinctIds.size).toBe(1)
    const [, count] = await service.listAndCountInventoryHoldings({ inventory_source_id: source.id, trading_card_variant_id: variantId })
    expect(count).toBe(1)
  })
})

describe("inventory proposal", () => {
  it("creates a pending proposal and follows the validated review-status transition path", async () => {
    const source = await createSource()
    const proposal = await service.createInventoryProposal({
      inventorySourceId: source.id, tradingCardVariantId: `tcvar_${suffix()}`, changeKind: "NEW_HOLDING", actor: "test-actor", source: "MANUAL",
    })
    expect(proposal.review_status).toBe("PENDING")
    await expect(service.transitionInventoryProposalStatus({
      id: proposal.id, targetStatus: "APPLIED", actor: "test-actor", source: "MANUAL",
    })).rejects.toThrow()
    const approved = await service.transitionInventoryProposalStatus({ id: proposal.id, targetStatus: "APPROVED", actor: "test-actor", source: "MANUAL" })
    expect(approved.review_status).toBe("APPROVED")
  })

  it("requires an UNRESOLVED_VARIANT change kind when no variant is given", async () => {
    const source = await createSource()
    await expect(service.createInventoryProposal({
      inventorySourceId: source.id, tradingCardVariantId: null, changeKind: "NEW_HOLDING", actor: "test-actor", source: "MANUAL",
    })).rejects.toThrow()
    const proposal = await service.createInventoryProposal({
      inventorySourceId: source.id, tradingCardVariantId: null, changeKind: "UNRESOLVED_VARIANT", actor: "test-actor", source: "MANUAL",
    })
    expect(proposal.trading_card_variant_id).toBeNull()
  })
})

describe("inventory transaction ledger", () => {
  it("appends a transaction with a consistent signed delta", async () => {
    const transaction = await service.appendInventoryTransaction({
      tradingCardVariantId: `tcvar_${suffix()}`, quantityBefore: 5, quantityAfter: 2,
      reason: "WEBSITE_SALE", actor: "test-actor", source: "SYSTEM",
    })
    expect(transaction.quantity_delta).toBe(-3)
  })

  it("rejects an inconsistent before/after/delta combination at the database level", async () => {
    await expect(service.createInventoryTransactions({
      trading_card_variant_id: `tcvar_${suffix()}`, quantity_before: 5, quantity_after: 2, quantity_delta: 1, reason: "WEBSITE_SALE", actor: "test-actor",
    })).rejects.toThrow()
  })

  it("is idempotent when the same idempotency key is reused", async () => {
    const key = `idem_${suffix()}`
    const variantId = `tcvar_${suffix()}`
    const first = await service.appendInventoryTransaction({
      tradingCardVariantId: variantId, quantityBefore: 5, quantityAfter: 4, reason: "WEBSITE_SALE",
      actor: "test-actor", source: "SYSTEM", idempotencyKey: key,
    })
    const second = await service.appendInventoryTransaction({
      tradingCardVariantId: variantId, quantityBefore: 5, quantityAfter: 4, reason: "WEBSITE_SALE",
      actor: "test-actor", source: "SYSTEM", idempotencyKey: key,
    })
    expect(second.id).toBe(first.id)
  })
})

describe("Stage 5B.2 proposal review and application", () => {
  async function approvedProposal(sourceId: string, variantId: string, overrides: Record<string, unknown> = {}) {
    const proposal = await service.createInventoryProposal({
      inventorySourceId: sourceId, tradingCardVariantId: variantId, changeKind: "QUANTITY_CHANGE",
      previousQuantity: 0, proposedQuantity: 5, actor: "test-actor", source: "MANUAL", ...overrides,
    })
    return service.transitionInventoryProposalStatus({ id: proposal.id, targetStatus: "APPROVED", actor: "reviewer", source: "MANUAL" })
  }

  describe("reviewInventoryProposals (bulk approve/reject)", () => {
    it("approves every PENDING id in the batch and persists reviewer identity, timestamp and note", async () => {
      const source = await createSource()
      const a = await service.createInventoryProposal({
        inventorySourceId: source.id, tradingCardVariantId: `tcvar_${suffix()}`, changeKind: "NEW_HOLDING", actor: "test-actor", source: "MANUAL",
      })
      const b = await service.createInventoryProposal({
        inventorySourceId: source.id, tradingCardVariantId: `tcvar_${suffix()}`, changeKind: "NEW_HOLDING", actor: "test-actor", source: "MANUAL",
      })
      const [updatedA, updatedB] = await service.reviewInventoryProposals({
        ids: [a.id, b.id], targetStatus: "APPROVED", reviewNote: "looks correct", actor: "reviewer-1", source: "MANUAL",
      })
      for (const row of [updatedA, updatedB]) {
        expect(row.review_status).toBe("APPROVED")
        expect(row.resolved_by).toBe("reviewer-1")
        expect(row.resolved_at).not.toBeNull()
        expect(row.review_note).toBe("looks correct")
      }
    })

    it("rejects the whole batch with no mutation when any id is not PENDING (all-or-nothing)", async () => {
      const source = await createSource()
      const pending = await service.createInventoryProposal({
        inventorySourceId: source.id, tradingCardVariantId: `tcvar_${suffix()}`, changeKind: "NEW_HOLDING", actor: "test-actor", source: "MANUAL",
      })
      const alreadyApproved = await approvedProposal(source.id, `tcvar_${suffix()}`)
      await expect(service.reviewInventoryProposals({
        ids: [pending.id, alreadyApproved.id], targetStatus: "APPROVED", actor: "reviewer-1", source: "MANUAL",
      })).rejects.toThrow(/not PENDING/)
      const stillPending = await service.retrieveInventoryProposal(pending.id)
      expect(stillPending.review_status).toBe("PENDING")
    })

    it("only persists rejection_reason when rejecting", async () => {
      const source = await createSource()
      const proposal = await service.createInventoryProposal({
        inventorySourceId: source.id, tradingCardVariantId: `tcvar_${suffix()}`, changeKind: "NEW_HOLDING", actor: "test-actor", source: "MANUAL",
      })
      const [rejected] = await service.reviewInventoryProposals({
        ids: [proposal.id], targetStatus: "REJECTED", rejectionReason: "duplicate row", actor: "reviewer-1", source: "MANUAL",
      })
      expect(rejected.review_status).toBe("REJECTED")
      expect(rejected.rejection_reason).toBe("duplicate row")
    })
  })

  describe("applyInventoryProposal (Phase A)", () => {
    it("applies a QUANTITY_CHANGE proposal: updates the holding, appends the ledger, marks APPLIED with sync PENDING", async () => {
      const source = await createSource()
      const variantId = `tcvar_${suffix()}`
      await service.upsertInventoryHolding({ inventorySourceId: source.id, tradingCardVariantId: variantId, quantity: 3, actor: "test-actor", source: "MANUAL" })
      const proposal = await approvedProposal(source.id, variantId, { previousQuantity: 3, proposedQuantity: 8 })

      const result = await service.applyInventoryProposal({ id: proposal.id, actor: "applier", source: "MANUAL" })
      expect(result).toMatchObject({ localApplicationStatus: "APPLIED", resultingQuantity: 8, medusaSyncStatus: "PENDING" })
      expect(result.transactionId).not.toBeNull()

      const [holding] = await service.listInventoryHoldings({ inventory_source_id: source.id, trading_card_variant_id: variantId })
      expect(holding.quantity).toBe(8)

      const applied = await service.retrieveInventoryProposal(proposal.id)
      expect(applied).toMatchObject({ review_status: "APPLIED", medusa_sync_status: "PENDING" })
      expect(applied.applied_transaction_id).toBe(result.transactionId)
      expect(applied.applied_holding_id).toBe(holding.id)
    }, 30000)

    it("creates the holding for a NEW_HOLDING proposal when none exists yet", async () => {
      const source = await createSource()
      const variantId = `tcvar_${suffix()}`
      const proposal = await approvedProposal(source.id, variantId, { changeKind: "NEW_HOLDING", previousQuantity: 0, proposedQuantity: 6 })
      const categoryId = `ebstorecat_${suffix()}`
      await pgConnection.raw(
        `insert into ebay_integration_store_category
          (id, environment, ebay_account_id, external_id, name, sibling_order, level, path, status, source, medusa_category_id)
         values (?, 'SANDBOX', ?, ?, 'Test category', 1, 1, 'Test category', 'ACTIVE', 'MANUAL', ?)`,
        [categoryId, `acct_${suffix()}`, `ext_${suffix()}`, `pcat_${suffix()}`],
      )
      await pgConnection.raw(
        `update trading_card_inventory_proposal
         set confirmed_ebay_store_category_id = ?, category_confirmed_at = now(), category_confirmed_by = 'reviewer'
         where id = ?`,
        [categoryId, proposal.id],
      )
      const result = await service.applyInventoryProposal({ id: proposal.id, actor: "applier", source: "MANUAL" })
      expect(result.localApplicationStatus).toBe("APPLIED")
      const [, count] = await service.listAndCountInventoryHoldings({ inventory_source_id: source.id, trading_card_variant_id: variantId })
      expect(count).toBe(1)
    }, 30000)

    it("is idempotent: re-applying an already-APPLIED proposal returns success without a second ledger row or holding movement", async () => {
      const source = await createSource()
      const variantId = `tcvar_${suffix()}`
      const proposal = await approvedProposal(source.id, variantId, { previousQuantity: 0, proposedQuantity: 4 })
      const first = await service.applyInventoryProposal({ id: proposal.id, actor: "applier", source: "MANUAL" })
      const second = await service.applyInventoryProposal({ id: proposal.id, actor: "applier", source: "MANUAL" })
      expect(second.localApplicationStatus).toBe("ALREADY_APPLIED")
      expect(second.transactionId).toBe(first.transactionId)
      const [, count] = await service.listAndCountInventoryTransactions({ trading_card_variant_id: variantId })
      expect(count).toBe(1)
    }, 30000)

    it("serialises two concurrent apply attempts for one proposal", async () => {
      const source = await createSource()
      const variantId = `tcvar_${suffix()}`
      const proposal = await approvedProposal(source.id, variantId, { previousQuantity: 0, proposedQuantity: 4 })

      const results = await Promise.all([
        service.applyInventoryProposal({ id: proposal.id, actor: "applier-a", source: "MANUAL" }),
        service.applyInventoryProposal({ id: proposal.id, actor: "applier-b", source: "MANUAL" }),
      ])

      expect(results.map((result: Record<string, unknown>) => result.localApplicationStatus).sort()).toEqual(["ALREADY_APPLIED", "APPLIED"])
      expect(new Set(results.map((result: Record<string, unknown>) => result.transactionId)).size).toBe(1)
      const [, transactionCount] = await service.listAndCountInventoryTransactions({ trading_card_variant_id: variantId })
      expect(transactionCount).toBe(1)
    }, 30000)

    it("serialises different proposals sharing one baseline so only one can move the holding", async () => {
      const source = await createSource()
      const variantId = `tcvar_${suffix()}`
      await service.upsertInventoryHolding({ inventorySourceId: source.id, tradingCardVariantId: variantId, quantity: 2, actor: "test-actor", source: "MANUAL" })
      const first = await approvedProposal(source.id, variantId, { previousQuantity: 2, proposedQuantity: 5 })
      const second = await approvedProposal(source.id, variantId, { previousQuantity: 2, proposedQuantity: 7 })

      const results = await Promise.all([
        service.applyInventoryProposal({ id: first.id, actor: "applier-a", source: "MANUAL" }),
        service.applyInventoryProposal({ id: second.id, actor: "applier-b", source: "MANUAL" }),
      ])

      expect(results.filter((result: Record<string, unknown>) => result.localApplicationStatus === "APPLIED")).toHaveLength(1)
      expect(results.filter((result: Record<string, unknown>) => result.localApplicationStatus === "STALE_BASELINE")).toHaveLength(1)
      const [, transactionCount] = await service.listAndCountInventoryTransactions({ trading_card_variant_id: variantId })
      expect(transactionCount).toBe(1)
    }, 30000)

    it("different caller-supplied idempotency keys cannot double-apply the same proposal", async () => {
      const source = await createSource()
      const variantId = `tcvar_${suffix()}`
      const proposal = await approvedProposal(source.id, variantId, { previousQuantity: 0, proposedQuantity: 4 })
      const first = await service.applyInventoryProposal({ id: proposal.id, applicationIdempotencyKey: "key-a", actor: "applier", source: "MANUAL" })
      const second = await service.applyInventoryProposal({ id: proposal.id, applicationIdempotencyKey: "key-b", actor: "applier", source: "MANUAL" })
      expect(second.localApplicationStatus).toBe("ALREADY_APPLIED")
      expect(second.transactionId).toBe(first.transactionId)
      const saved = await service.retrieveInventoryProposal(proposal.id)
      const transaction = await service.retrieveInventoryTransaction(first.transactionId)
      expect(saved.application_idempotency_key).toBe(proposal.id)
      expect(transaction.idempotency_key).toBe(proposal.id)
    }, 30000)

    it("rejects PENDING and REJECTED proposals as INVALID_STATE without mutation", async () => {
      const source = await createSource()
      const pending = await service.createInventoryProposal({
        inventorySourceId: source.id, tradingCardVariantId: `tcvar_${suffix()}`, changeKind: "NEW_HOLDING", actor: "test-actor", source: "MANUAL",
      })
      const pendingResult = await service.applyInventoryProposal({ id: pending.id, actor: "applier", source: "MANUAL" })
      expect(pendingResult.localApplicationStatus).toBe("INVALID_STATE")

      const [rejected] = await service.reviewInventoryProposals({
        ids: [(await service.createInventoryProposal({
          inventorySourceId: source.id, tradingCardVariantId: `tcvar_${suffix()}`, changeKind: "NEW_HOLDING", actor: "test-actor", source: "MANUAL",
        })).id],
        targetStatus: "REJECTED", rejectionReason: "bad", actor: "reviewer", source: "MANUAL",
      })
      const rejectedResult = await service.applyInventoryProposal({ id: rejected.id, actor: "applier", source: "MANUAL" })
      expect(rejectedResult.localApplicationStatus).toBe("INVALID_STATE")
    })

    it("rejects PRICE_CHANGE/COST_CHANGE proposals as OUT_OF_SCOPE without mutating the holding", async () => {
      const source = await createSource()
      const variantId = `tcvar_${suffix()}`
      await service.upsertInventoryHolding({ inventorySourceId: source.id, tradingCardVariantId: variantId, quantity: 2, actor: "test-actor", source: "MANUAL" })
      const proposal = await approvedProposal(source.id, variantId, { changeKind: "PRICE_CHANGE", previousQuantity: 2, proposedQuantity: 2 })
      const result = await service.applyInventoryProposal({ id: proposal.id, actor: "applier", source: "MANUAL" })
      expect(result.localApplicationStatus).toBe("OUT_OF_SCOPE")
      const [holding] = await service.listInventoryHoldings({ inventory_source_id: source.id, trading_card_variant_id: variantId })
      expect(holding.quantity).toBe(2)
    })

    it("detects a stale baseline (holding drifted since approval) and applies no mutation", async () => {
      const source = await createSource()
      const variantId = `tcvar_${suffix()}`
      await service.upsertInventoryHolding({ inventorySourceId: source.id, tradingCardVariantId: variantId, quantity: 3, actor: "test-actor", source: "MANUAL" })
      const proposal = await approvedProposal(source.id, variantId, { previousQuantity: 3, proposedQuantity: 10 })
      // Baseline drifts after approval, before apply.
      await service.upsertInventoryHolding({ inventorySourceId: source.id, tradingCardVariantId: variantId, quantity: 99, actor: "someone-else", source: "MANUAL" })

      const result = await service.applyInventoryProposal({ id: proposal.id, actor: "applier", source: "MANUAL" })
      expect(result).toMatchObject({ localApplicationStatus: "STALE_BASELINE", errorCode: "STALE_BASELINE" })
      const [holding] = await service.listInventoryHoldings({ inventory_source_id: source.id, trading_card_variant_id: variantId })
      expect(holding.quantity).toBe(99)
      const stillApproved = await service.retrieveInventoryProposal(proposal.id)
      expect(stillApproved.review_status).toBe("APPROVED")
      const entries = await service.listInventoryAuditEntries({ entity_type: "INVENTORY_PROPOSAL", entity_id: proposal.id })
      expect(entries.some((entry: Record<string, unknown>) => entry.action === "PROPOSAL_APPLICATION_REJECTED_STALE_BASELINE")).toBe(true)
    }, 30000)
  })

  describe("applyInventoryProposals (bulk apply, partial success)", () => {
    it("applies eligible proposals while one stale proposal fails independently", async () => {
      const source = await createSource()
      const okVariant = `tcvar_${suffix()}`
      const staleVariant = `tcvar_${suffix()}`
      await service.upsertInventoryHolding({ inventorySourceId: source.id, tradingCardVariantId: staleVariant, quantity: 1, actor: "test-actor", source: "MANUAL" })
      const ok = await approvedProposal(source.id, okVariant, { previousQuantity: 0, proposedQuantity: 3 })
      const stale = await approvedProposal(source.id, staleVariant, { previousQuantity: 1, proposedQuantity: 5 })
      await service.upsertInventoryHolding({ inventorySourceId: source.id, tradingCardVariantId: staleVariant, quantity: 50, actor: "drift", source: "MANUAL" })

      const { results } = await service.applyInventoryProposals({ ids: [ok.id, stale.id], actor: "applier", source: "MANUAL" })
      const okResult = results.find((row: Record<string, unknown>) => row.proposalId === ok.id)
      const staleResult = results.find((row: Record<string, unknown>) => row.proposalId === stale.id)
      expect(okResult.localApplicationStatus).toBe("APPLIED")
      expect(staleResult.localApplicationStatus).toBe("STALE_BASELINE")
    }, 30000)
  })

  describe("Medusa sync-state tracking", () => {
    it("begins a sync attempt, records success, and the proposal is fully synced", async () => {
      const source = await createSource()
      const variantId = `tcvar_${suffix()}`
      const proposal = await approvedProposal(source.id, variantId, { previousQuantity: 0, proposedQuantity: 2 })
      await service.applyInventoryProposal({ id: proposal.id, actor: "applier", source: "MANUAL" })

      const { attemptToken } = await service.beginMedusaSyncAttempt({ proposalId: proposal.id, actor: "syncer", source: "SYSTEM" })
      expect(attemptToken).not.toBeNull()
      const synced = await service.recordMedusaSyncResult({
        proposalId: proposal.id, attemptToken, outcome: "SYNCED",
        medusaInventoryItemId: "iitem_1", medusaStockLocationId: "sloc_1", actor: "syncer", source: "SYSTEM",
      })
      expect(synced.medusa_sync_status).toBe("SYNCED")
    }, 30000)

    it("a late FAILED result carrying a superseded attempt token cannot regress an already-SYNCED proposal", async () => {
      const source = await createSource()
      const variantId = `tcvar_${suffix()}`
      const proposal = await approvedProposal(source.id, variantId, { previousQuantity: 0, proposedQuantity: 2 })
      await service.applyInventoryProposal({ id: proposal.id, actor: "applier", source: "MANUAL" })

      const first = await service.beginMedusaSyncAttempt({ proposalId: proposal.id, actor: "syncer", source: "SYSTEM" })
      await service.recordMedusaSyncResult({ proposalId: proposal.id, attemptToken: first.attemptToken, outcome: "SYNCED", actor: "syncer", source: "SYSTEM" })

      // A stale/duplicate FAILED result using the superseded token must be discarded, not regress SYNCED.
      const stale = await service.recordMedusaSyncResult({
        proposalId: proposal.id, attemptToken: first.attemptToken, outcome: "FAILED",
        error: { category: "MEDUSA_LEVEL_UPDATE_FAILED", message: "late" }, actor: "syncer", source: "SYSTEM",
      })
      expect(stale.medusa_sync_status).toBe("SYNCED")
    }, 30000)

    it("beginMedusaSyncAttempt refuses to start a new attempt once already SYNCED", async () => {
      const source = await createSource()
      const variantId = `tcvar_${suffix()}`
      const proposal = await approvedProposal(source.id, variantId, { previousQuantity: 0, proposedQuantity: 2 })
      await service.applyInventoryProposal({ id: proposal.id, actor: "applier", source: "MANUAL" })
      const first = await service.beginMedusaSyncAttempt({ proposalId: proposal.id, actor: "syncer", source: "SYSTEM" })
      await service.recordMedusaSyncResult({ proposalId: proposal.id, attemptToken: first.attemptToken, outcome: "SYNCED", actor: "syncer", source: "SYSTEM" })

      const second = await service.beginMedusaSyncAttempt({ proposalId: proposal.id, actor: "syncer", source: "SYSTEM" })
      expect(second.attemptToken).toBeNull()
      expect(second.proposal.medusa_sync_status).toBe("SYNCED")
    }, 30000)

    it("allows only one active sync attempt when retries begin concurrently", async () => {
      const source = await createSource()
      const variantId = `tcvar_${suffix()}`
      const proposal = await approvedProposal(source.id, variantId, { previousQuantity: 0, proposedQuantity: 2 })
      await service.applyInventoryProposal({ id: proposal.id, actor: "applier", source: "MANUAL" })
      const initial = await service.beginMedusaSyncAttempt({ proposalId: proposal.id, actor: "syncer", source: "SYSTEM" })
      await service.recordMedusaSyncResult({
        proposalId: proposal.id, attemptToken: initial.attemptToken, outcome: "FAILED",
        error: { category: "NO_STOCK_LOCATION", message: "none configured" }, actor: "syncer", source: "SYSTEM",
      })

      const attempts = await Promise.all([
        service.beginMedusaSyncAttempt({ proposalId: proposal.id, actor: "syncer-a", source: "SYSTEM" }),
        service.beginMedusaSyncAttempt({ proposalId: proposal.id, actor: "syncer-b", source: "SYSTEM" }),
      ])

      expect(attempts.filter((attempt: Record<string, unknown>) => attempt.attemptToken !== null)).toHaveLength(1)
      expect(attempts.filter((attempt: Record<string, unknown>) => attempt.attemptToken === null)).toHaveLength(1)
      const audits = await service.listInventoryAuditEntries({ entity_type: "INVENTORY_PROPOSAL", entity_id: proposal.id, action: "MEDUSA_SYNC_RETRIED" })
      expect(audits).toHaveLength(1)
    }, 30000)

    it("supersedes an expired attempt lease and ignores the interrupted worker's late result", async () => {
      const source = await createSource()
      const variantId = `tcvar_${suffix()}`
      const proposal = await approvedProposal(source.id, variantId, { previousQuantity: 0, proposedQuantity: 2 })
      await service.applyInventoryProposal({ id: proposal.id, actor: "applier", source: "MANUAL" })
      const interrupted = await service.beginMedusaSyncAttempt({ proposalId: proposal.id, actor: "syncer-a", source: "SYSTEM" })
      await pgConnection.raw(
        `update trading_card_inventory_proposal set medusa_sync_attempted_at = now() - interval '10 minutes' where id = ?`,
        [proposal.id],
      )

      const resumed = await service.beginMedusaSyncAttempt({ proposalId: proposal.id, actor: "syncer-b", source: "SYSTEM" })
      expect(resumed.attemptToken).not.toBeNull()
      expect(resumed.attemptToken).not.toBe(interrupted.attemptToken)
      const late = await service.recordMedusaSyncResult({
        proposalId: proposal.id, attemptToken: interrupted.attemptToken, outcome: "FAILED",
        error: { category: "MEDUSA_DEPENDENCY_FAILED", message: "late" }, actor: "syncer-a", source: "SYSTEM",
      })
      expect(late.medusa_sync_status).toBe("PENDING")
      expect(late.medusa_sync_attempt_token).toBe(resumed.attemptToken)
    }, 30000)

    it("a retried sync attempt mints a new token, invalidating results tagged with the previous one", async () => {
      const source = await createSource()
      const variantId = `tcvar_${suffix()}`
      const proposal = await approvedProposal(source.id, variantId, { previousQuantity: 0, proposedQuantity: 2 })
      await service.applyInventoryProposal({ id: proposal.id, actor: "applier", source: "MANUAL" })

      const first = await service.beginMedusaSyncAttempt({ proposalId: proposal.id, actor: "syncer", source: "SYSTEM" })
      await service.recordMedusaSyncResult({
        proposalId: proposal.id, attemptToken: first.attemptToken, outcome: "FAILED",
        error: { category: "NO_STOCK_LOCATION", message: "none configured" }, actor: "syncer", source: "SYSTEM",
      })
      const retry = await service.beginMedusaSyncAttempt({ proposalId: proposal.id, actor: "syncer", source: "SYSTEM" })
      expect(retry.attemptToken).not.toBe(first.attemptToken)
      expect(retry.proposal.medusa_sync_retry_count).toBe(1)

      // A result using the first (now-superseded) token no longer applies.
      const ignored = await service.recordMedusaSyncResult({
        proposalId: proposal.id, attemptToken: first.attemptToken, outcome: "SYNCED", actor: "syncer", source: "SYSTEM",
      })
      expect(ignored.medusa_sync_status).toBe("PENDING")

      const applied = await service.recordMedusaSyncResult({
        proposalId: proposal.id, attemptToken: retry.attemptToken, outcome: "SYNCED", actor: "syncer", source: "SYSTEM",
      })
      expect(applied.medusa_sync_status).toBe("SYNCED")
    }, 30000)
  })

  describe("card-creation claim + resolveInventoryProposalVariant (Stage 5B.3)", () => {
    /**
     * Builds an UNRESOLVED_VARIANT proposal the way the real pipeline does:
     * an entry with no variant, an UNMATCHED match row for it (matching
     * always runs before reconciliation in production), then reconciliation
     * derives the UNRESOLVED_VARIANT proposal from the null-variant entry.
     */
    async function unresolvedVariantProposal(sourceId: string, providerReference: string) {
      const snapshot = await service.createInventorySnapshot({ inventorySourceId: sourceId, actor: "test-actor", source: "MANUAL" })
      await service.addInventorySnapshotEntries({
        snapshotId: snapshot.id, actor: "test-actor", source: "MANUAL",
        entries: [{
          providerReference, providerReferenceType: "PULSE_PRODUCT_ID", tradingCardVariantId: null,
          quantity: 1, currencyCode: "GBP", unitAcquisitionCost: "1.00", unitMarketPrice: "2.00", unitSellingPrice: "3.00",
        }],
      })
      await service.transitionInventorySnapshotStatus({ id: snapshot.id, targetStatus: "VALIDATED", actor: "test-actor", source: "MANUAL" })
      const [entry] = await service.listInventorySnapshotEntries({ inventory_snapshot_id: snapshot.id, provider_reference: providerReference })
      await service.recordSnapshotEntryMatch({
        snapshotEntryId: entry.id, inventorySnapshotId: snapshot.id, matchingStatus: "UNMATCHED", matchedVia: "NONE",
        diagnostics: [], actor: "test-actor", source: "SYSTEM",
      })
      await service.reconcileInventorySnapshot({ inventorySourceId: sourceId, snapshotId: snapshot.id, actor: "reconciler", source: "SYSTEM" })
      const [proposal] = await service.listInventoryProposals({ inventory_snapshot_id: snapshot.id, provider_reference: providerReference })
      expect(proposal.change_kind).toBe("UNRESOLVED_VARIANT")
      return { snapshotId: snapshot.id, entryId: entry.id, proposal }
    }

    describe("beginCardCreationClaim", () => {
      it("mints a claim token for a pending, unresolved-variant proposal", async () => {
        const source = await createSource()
        const { proposal } = await unresolvedVariantProposal(source.id, `claim-${suffix()}`)
        const claim = await service.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })
        expect(claim.alreadyResolved).toBe(false)
        expect(typeof claim.claimToken).toBe("string")
        const refreshed = await service.retrieveInventoryProposal(proposal.id)
        expect(refreshed.card_creation_claim_token).toBe(claim.claimToken)
        expect(refreshed.card_creation_claimed_at).not.toBeNull()
      }, 30000)

      it("refuses a second claim while the first is within its lease window", async () => {
        const source = await createSource()
        const { proposal } = await unresolvedVariantProposal(source.id, `lease-${suffix()}`)
        const first = await service.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer-a", source: "MANUAL" })
        const second = await service.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer-b", source: "MANUAL" })
        expect(second.claimToken).toBeNull()
        expect(second.alreadyResolved).toBe(false)
        const refreshed = await service.retrieveInventoryProposal(proposal.id)
        expect(refreshed.card_creation_claim_token).toBe(first.claimToken)
      }, 30000)

      it("serialises two concurrent claim attempts for the same proposal — exactly one wins", async () => {
        const source = await createSource()
        const { proposal } = await unresolvedVariantProposal(source.id, `concurrent-${suffix()}`)
        const [a, b] = await Promise.all([
          service.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer-a", source: "MANUAL" }),
          service.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer-b", source: "MANUAL" }),
        ])
        const tokens = [a.claimToken, b.claimToken].filter((token): token is string => token !== null)
        expect(tokens).toHaveLength(1)
      }, 30000)

      it("is a no-op, alreadyResolved short-circuit once the proposal already carries a resolved variant", async () => {
        const source = await createSource()
        const providerReference = `already-${suffix()}`
        const { proposal } = await unresolvedVariantProposal(source.id, providerReference)
        const claim = await service.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })
        const variantId = `tcvar_${suffix()}`
        await service.resolveInventoryProposalVariant({
          proposalId: proposal.id, claimToken: claim.claimToken, tradingCardVariantId: variantId, actor: "reviewer", source: "MANUAL",
        })
        const replay = await service.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })
        expect(replay).toMatchObject({ alreadyResolved: true, claimToken: null, tradingCardVariantId: variantId })
      }, 30000)

      it("rejects a proposal that is not pending / unresolved-variant", async () => {
        const source = await createSource()
        const proposal = await service.createInventoryProposal({
          inventorySourceId: source.id, tradingCardVariantId: `tcvar_${suffix()}`, changeKind: "QUANTITY_CHANGE",
          previousQuantity: 0, proposedQuantity: 5, actor: "test-actor", source: "MANUAL",
        })
        await expect(service.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" }))
          .rejects.toThrow(/unresolved-variant proposal/)
      })
    })

    describe("resolveInventoryProposalVariant", () => {
      it("atomically resolves the proposal and its snapshot entry match to the new variant", async () => {
        const source = await createSource()
        const providerReference = `resolve-${suffix()}`
        const { proposal, entryId } = await unresolvedVariantProposal(source.id, providerReference)
        const claim = await service.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })
        const variantId = `tcvar_${suffix()}`

        const resolved = await service.resolveInventoryProposalVariant({
          proposalId: proposal.id, claimToken: claim.claimToken, tradingCardVariantId: variantId, actor: "reviewer", source: "MANUAL",
        })
        expect(resolved).toMatchObject({ change_kind: "NEW_HOLDING", trading_card_variant_id: variantId })

        const [match] = await service.listInventorySnapshotEntryMatches({ snapshot_entry_id: entryId })
        expect(match).toMatchObject({ matching_status: "MATCHED", trading_card_variant_id: variantId, matched_via: "MANUAL" })

        const refreshedProposal = await service.retrieveInventoryProposal(proposal.id)
        expect(refreshedProposal.card_creation_claim_token).toBeNull()
        expect(refreshedProposal.card_creation_claimed_at).toBeNull()
      }, 30000)

      it("rejects a stale claim token — a superseded attempt cannot complete resolution", async () => {
        const source = await createSource()
        const { proposal } = await unresolvedVariantProposal(source.id, `stale-${suffix()}`)
        const claim = await service.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })
        await expect(service.resolveInventoryProposalVariant({
          proposalId: proposal.id, claimToken: "not-the-real-token", tradingCardVariantId: `tcvar_${suffix()}`, actor: "reviewer", source: "MANUAL",
        })).rejects.toThrow(/stale/)
        // the legitimate claim is untouched and can still complete
        const resolved = await service.resolveInventoryProposalVariant({
          proposalId: proposal.id, claimToken: claim.claimToken, tradingCardVariantId: `tcvar_${suffix()}`, actor: "reviewer", source: "MANUAL",
        })
        expect(resolved.change_kind).toBe("NEW_HOLDING")
      }, 30000)

      it("is idempotent when replayed with the exact variant it already resolved to", async () => {
        const source = await createSource()
        const { proposal } = await unresolvedVariantProposal(source.id, `replay-${suffix()}`)
        const claim = await service.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })
        const variantId = `tcvar_${suffix()}`
        await service.resolveInventoryProposalVariant({
          proposalId: proposal.id, claimToken: claim.claimToken, tradingCardVariantId: variantId, actor: "reviewer", source: "MANUAL",
        })
        const replay = await service.resolveInventoryProposalVariant({
          proposalId: proposal.id, claimToken: claim.claimToken, tradingCardVariantId: variantId, actor: "reviewer", source: "MANUAL",
        })
        expect(replay.trading_card_variant_id).toBe(variantId)
      }, 30000)

      it("rejects resolving to a different variant than it was already resolved to", async () => {
        const source = await createSource()
        const { proposal } = await unresolvedVariantProposal(source.id, `mismatch-${suffix()}`)
        const claim = await service.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })
        const firstVariantId = `tcvar_${suffix()}`
        await service.resolveInventoryProposalVariant({
          proposalId: proposal.id, claimToken: claim.claimToken, tradingCardVariantId: firstVariantId, actor: "reviewer", source: "MANUAL",
        })
        await expect(service.resolveInventoryProposalVariant({
          proposalId: proposal.id, claimToken: claim.claimToken, tradingCardVariantId: `tcvar_${suffix()}`, actor: "reviewer", source: "MANUAL",
        })).rejects.toThrow(/different trading card variant/)
      }, 30000)

      it("the MANUAL match cannot be silently overwritten by a plain re-match once the snapshot has moved to PENDING_REVIEW", async () => {
        const source = await createSource()
        const providerReference = `retry-preserve-${suffix()}`
        const { snapshotId, entryId, proposal } = await unresolvedVariantProposal(source.id, providerReference)
        const claim = await service.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })
        const variantId = `tcvar_${suffix()}`
        await service.resolveInventoryProposalVariant({
          proposalId: proposal.id, claimToken: claim.claimToken, tradingCardVariantId: variantId, actor: "reviewer", source: "MANUAL",
        })
        // Reconciliation already moved the snapshot to PENDING_REVIEW — the plain
        // create-or-update matcher only accepts DRAFT/VALIDATED snapshots, so a
        // naive re-match cannot silently downgrade the manual resolution; only the
        // atomic `refreshPendingProposals` path (which re-validates the proposal
        // is still PENDING) is allowed to touch matching after this point.
        await expect(service.recordSnapshotEntryMatch({
          snapshotEntryId: entryId, inventorySnapshotId: snapshotId, matchingStatus: "UNMATCHED", matchedVia: "NONE",
          diagnostics: [], actor: "system", source: "SYSTEM",
        })).rejects.toThrow(/cannot be changed in this snapshot state/)

        const [match] = await service.listInventorySnapshotEntryMatches({ inventory_snapshot_id: snapshotId })
        expect(match).toMatchObject({ matching_status: "MATCHED", matched_via: "MANUAL", trading_card_variant_id: variantId })
      }, 30000)
    })
  })
})

/**
 * Codex remediation: a DISCARDED snapshot must never let one of its
 * proposals go on to review/apply/create-card, and discard racing a
 * concurrent apply must always land on one consistent outcome — never a
 * stock movement that happens after the snapshot was removed from the
 * working list. Every actionable path (`reviewInventoryProposals`,
 * `applyInventoryProposal`, `beginCardCreationClaim`,
 * `resolveInventoryProposalVariant`) now locks the proposal's snapshot row
 * (`for update`) and checks it hasn't been discarded — the same row lock
 * `transitionInventorySnapshotStatus` takes when moving a snapshot to
 * DISCARDED, so the two can never race past each other.
 */
describe("discard vs proposal actionability (Stage 5B.3 remediation)", () => {
  async function draftSnapshotWithProposal(sourceId: string) {
    const snapshot = await service.createInventorySnapshot({ inventorySourceId: sourceId, actor: "test-actor", source: "MANUAL" })
    const proposal = await service.createInventoryProposal({
      inventorySourceId: sourceId, inventorySnapshotId: snapshot.id, tradingCardVariantId: `tcvar_${suffix()}`,
      changeKind: "NEW_HOLDING", previousQuantity: 0, proposedQuantity: 5, actor: "test-actor", source: "MANUAL",
    })
    return { snapshot, proposal }
  }

  /** Mirrors `unresolvedVariantProposal` above, scoped to this describe block. */
  async function unresolvedVariantProposalOnSnapshot(sourceId: string, providerReference: string) {
    const snapshot = await service.createInventorySnapshot({ inventorySourceId: sourceId, actor: "test-actor", source: "MANUAL" })
    await service.addInventorySnapshotEntries({
      snapshotId: snapshot.id, actor: "test-actor", source: "MANUAL",
      entries: [{
        providerReference, providerReferenceType: "PULSE_PRODUCT_ID", tradingCardVariantId: null,
        quantity: 1, currencyCode: "GBP", unitAcquisitionCost: "1.00", unitMarketPrice: "2.00", unitSellingPrice: "3.00",
      }],
    })
    await service.transitionInventorySnapshotStatus({ id: snapshot.id, targetStatus: "VALIDATED", actor: "test-actor", source: "MANUAL" })
    const [entry] = await service.listInventorySnapshotEntries({ inventory_snapshot_id: snapshot.id, provider_reference: providerReference })
    await service.recordSnapshotEntryMatch({
      snapshotEntryId: entry.id, inventorySnapshotId: snapshot.id, matchingStatus: "UNMATCHED", matchedVia: "NONE",
      diagnostics: [], actor: "test-actor", source: "SYSTEM",
    })
    await service.reconcileInventorySnapshot({ inventorySourceId: sourceId, snapshotId: snapshot.id, actor: "reconciler", source: "SYSTEM" })
    const [proposal] = await service.listInventoryProposals({ inventory_snapshot_id: snapshot.id, provider_reference: providerReference })
    return { snapshot, proposal }
  }

  it("a discarded snapshot's PENDING proposal cannot be approved", async () => {
    const source = await createSource()
    const { snapshot, proposal } = await draftSnapshotWithProposal(source.id)
    await service.transitionInventorySnapshotStatus({ id: snapshot.id, targetStatus: "DISCARDED", actor: "admin", source: "MANUAL" })

    await expect(service.reviewInventoryProposals({
      ids: [proposal.id], targetStatus: "APPROVED", actor: "reviewer", source: "MANUAL",
    })).rejects.toThrow(/discarded/)

    const refreshed = await service.retrieveInventoryProposal(proposal.id)
    expect(refreshed.review_status).toBe("PENDING")
  }, 30000)

  it("a discarded snapshot's APPROVED proposal cannot be applied, and moves no stock", async () => {
    const source = await createSource()
    const { snapshot, proposal } = await draftSnapshotWithProposal(source.id)
    const [approved] = await service.reviewInventoryProposals({
      ids: [proposal.id], targetStatus: "APPROVED", actor: "reviewer", source: "MANUAL",
    })
    await service.transitionInventorySnapshotStatus({ id: snapshot.id, targetStatus: "DISCARDED", actor: "admin", source: "MANUAL" })

    const result = await service.applyInventoryProposal({ id: approved.id, actor: "applier", source: "MANUAL" })
    expect(result.localApplicationStatus).toBe("SNAPSHOT_DISCARDED")
    expect(result.errorCode).toBe("SNAPSHOT_DISCARDED")

    const [, holdingCount] = await service.listAndCountInventoryHoldings({
      inventory_source_id: source.id, trading_card_variant_id: proposal.trading_card_variant_id,
    })
    expect(holdingCount).toBe(0)
    const [, transactionCount] = await service.listAndCountInventoryTransactions({ trading_card_variant_id: proposal.trading_card_variant_id })
    expect(transactionCount).toBe(0)

    const stillApproved = await service.retrieveInventoryProposal(approved.id)
    expect(stillApproved.review_status).toBe("APPROVED")
  }, 30000)

  it("a discarded snapshot's UNRESOLVED_VARIANT proposal refuses a new card-creation claim", async () => {
    const source = await createSource()
    const { snapshot, proposal } = await unresolvedVariantProposalOnSnapshot(source.id, `discard-claim-${suffix()}`)
    await service.transitionInventorySnapshotStatus({ id: snapshot.id, targetStatus: "DISCARDED", actor: "admin", source: "MANUAL" })

    await expect(service.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" }))
      .rejects.toThrow(/discarded/)

    const refreshed = await service.retrieveInventoryProposal(proposal.id)
    expect(refreshed.card_creation_claim_token).toBeNull()
  }, 30000)

  it("a claim started before discard is cleared by the discard and cannot complete resolution afterwards", async () => {
    const source = await createSource()
    const { snapshot, proposal } = await unresolvedVariantProposalOnSnapshot(source.id, `discard-resolve-${suffix()}`)
    const claim = await service.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })
    expect(claim.claimToken).not.toBeNull()

    await service.transitionInventorySnapshotStatus({ id: snapshot.id, targetStatus: "DISCARDED", actor: "admin", source: "MANUAL" })

    const refreshed = await service.retrieveInventoryProposal(proposal.id)
    expect(refreshed.card_creation_claim_token).toBeNull()
    expect(refreshed.card_creation_claimed_at).toBeNull()

    await expect(service.resolveInventoryProposalVariant({
      proposalId: proposal.id, claimToken: claim.claimToken, tradingCardVariantId: `tcvar_${suffix()}`, actor: "reviewer", source: "MANUAL",
    })).rejects.toThrow(/discarded/)
  }, 30000)

  it("discard versus apply concurrency produces one safe terminal outcome with no post-discard stock movement", async () => {
    const source = await createSource()
    const { snapshot, proposal } = await draftSnapshotWithProposal(source.id)
    const [approved] = await service.reviewInventoryProposals({
      ids: [proposal.id], targetStatus: "APPROVED", actor: "reviewer", source: "MANUAL",
    })

    const [applyResult, discarded] = await Promise.all([
      service.applyInventoryProposal({ id: approved.id, actor: "applier", source: "MANUAL" }),
      service.transitionInventorySnapshotStatus({ id: snapshot.id, targetStatus: "DISCARDED", actor: "admin", source: "MANUAL" }),
    ])

    // Discard's own transition never depends on proposal state, so it always
    // succeeds regardless of how the race against apply resolved.
    expect(discarded.status).toBe("DISCARDED")
    expect(["APPLIED", "SNAPSHOT_DISCARDED"]).toContain(applyResult.localApplicationStatus)

    const [, holdingCount] = await service.listAndCountInventoryHoldings({
      inventory_source_id: source.id, trading_card_variant_id: proposal.trading_card_variant_id,
    })
    const [, transactionCount] = await service.listAndCountInventoryTransactions({ trading_card_variant_id: proposal.trading_card_variant_id })

    if (applyResult.localApplicationStatus === "APPLIED") {
      // Apply won the race and committed before discard took effect — a
      // legitimate pre-discard movement, exactly one of each row.
      expect(holdingCount).toBe(1)
      expect(transactionCount).toBe(1)
    } else {
      // Discard won the race — no stock movement ever happened.
      expect(holdingCount).toBe(0)
      expect(transactionCount).toBe(0)
    }
  }, 30000)
})
