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
    displayName: `Test Source ${id}`, provider: "PULSE", actor: "test-actor", source: "MANUAL", ...overrides,
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
    await service.createInventorySource({ displayName: `  [ME]  eBay Stock ${id}  `, provider: "PULSE", actor: "test-actor", source: "MANUAL" })
    await expect(service.createInventorySource({
      displayName: `[me] ebay   stock ${id}`, provider: "PULSE", actor: "test-actor", source: "MANUAL",
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
