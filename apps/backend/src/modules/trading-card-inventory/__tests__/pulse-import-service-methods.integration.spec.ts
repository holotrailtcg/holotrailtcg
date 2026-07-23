import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection } from "@medusajs/framework/utils"
import { TRADING_CARD_INVENTORY_MODULE } from "../index"
import { DuplicateSnapshotError } from "../service"

let pgConnection: ReturnType<typeof createPgConnection>
let rootConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let service: any

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

beforeAll(async () => {
  rootConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  pgConnection = await rootConnection.transaction() as never
  // Roll back the suite as one unit so it cannot pollute the shared test database.
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
    displayName: `Pulse Import Test Source ${id}`, provider: "PULSE", language: "EN", actor: "test-actor", source: "MANUAL", ...overrides,
  })
}

describe("createOrGetInventorySource", () => {
  it("creates a new source when no equivalent name exists", async () => {
    const id = suffix()
    const result = await service.createOrGetInventorySource({
      displayName: `Fresh Source ${id}`, provider: "PULSE", language: "EN", actor: "test-actor", source: "PULSE",
    })
    expect(result.created).toBe(true)
    expect(result.source.status).toBe("ACTIVE")
  })

  it("returns the existing active source instead of throwing on a repeat call", async () => {
    const id = suffix()
    const displayName = `Repeat Source ${id}`
    const first = await service.createOrGetInventorySource({ displayName, provider: "PULSE", language: "EN", actor: "test-actor", source: "PULSE" })
    const second = await service.createOrGetInventorySource({ displayName, provider: "PULSE", language: "EN", actor: "test-actor", source: "PULSE" })
    expect(second.created).toBe(false)
    expect(second.source.id).toBe(first.source.id)
  })

  it("refuses to resolve an archived source", async () => {
    const source = await createSource()
    await service.archiveInventorySource({ id: source.id, actor: "test-actor", source: "MANUAL" })
    await expect(service.createOrGetInventorySource({
      displayName: source.display_name, provider: "PULSE", language: "EN", actor: "test-actor", source: "PULSE",
    })).rejects.toThrow(/archived/i)
  })
})

describe("findLiveSnapshotByContentHash and createDraftSnapshot", () => {
  it("finds nothing before any snapshot exists for the hash", async () => {
    const source = await createSource()
    const found = await service.findLiveSnapshotByContentHash({ inventorySourceId: source.id, contentHash: "hash-none" })
    expect(found).toBeNull()
  })

  it("creates a draft snapshot, then throws DuplicateSnapshotError for the same source+hash", async () => {
    const source = await createSource()
    const contentHash = `hash-${suffix()}`
    const snapshot = await service.createDraftSnapshot({
      actor: "test-actor", source: "PULSE", inventorySourceId: source.id, originalFilename: "import.csv", contentHash,
    })
    expect(snapshot.status).toBe("DRAFT")

    const found = await service.findLiveSnapshotByContentHash({ inventorySourceId: source.id, contentHash })
    expect(found.id).toBe(snapshot.id)

    await expect(service.createDraftSnapshot({
      actor: "test-actor", source: "PULSE", inventorySourceId: source.id, originalFilename: "import.csv", contentHash,
    })).rejects.toThrow(DuplicateSnapshotError)
  })

  it("allows the same bytes against a different source", async () => {
    const sourceA = await createSource()
    const sourceB = await createSource()
    const contentHash = `hash-shared-${suffix()}`
    const snapshotA = await service.createDraftSnapshot({ actor: "test-actor", source: "PULSE", inventorySourceId: sourceA.id, contentHash })
    const snapshotB = await service.createDraftSnapshot({ actor: "test-actor", source: "PULSE", inventorySourceId: sourceB.id, contentHash })
    expect(snapshotA.id).not.toBe(snapshotB.id)
  })

  it("does not treat a REJECTED snapshot as a live duplicate", async () => {
    const source = await createSource()
    const contentHash = `hash-rejected-${suffix()}`
    const snapshot = await service.createDraftSnapshot({ actor: "test-actor", source: "PULSE", inventorySourceId: source.id, contentHash })
    await service.transitionInventorySnapshotStatus({ id: snapshot.id, targetStatus: "FAILED", actor: "test-actor", source: "PULSE", failureReason: "test" })
    const found = await service.findLiveSnapshotByContentHash({ inventorySourceId: source.id, contentHash })
    expect(found).toBeNull()
    const retried = await service.createDraftSnapshot({ actor: "test-actor", source: "PULSE", inventorySourceId: source.id, contentHash })
    expect(retried.id).not.toBe(snapshot.id)
  })

  it("refuses snapshot creation after the source is archived", async () => {
    const source = await createSource()
    await service.archiveInventorySource({ id: source.id, actor: "test-actor", source: "MANUAL" })
    await expect(service.createDraftSnapshot({
      actor: "test-actor", source: "PULSE", inventorySourceId: source.id, contentHash: `hash-${suffix()}`,
    })).rejects.toThrow(/archived/i)
  })
})

describe("recordSnapshotEntryMatches", () => {
  async function snapshotWithEntries(count: number) {
    const source = await createSource()
    const snapshot = await service.createInventorySnapshot({ inventorySourceId: source.id, actor: "test-actor", source: "PULSE" })
    const rows = Array.from({ length: count }, (_, index) => ({
      rowNumber: index + 1, outcome: "VALID", providerReference: `card:test|${suffix()}|${index}`,
      providerReferenceType: "PULSE_PRODUCT_ID", quantity: 1, languageConflict: false, diagnostics: [],
    }))
    const persisted = await service.addInventorySnapshotEntriesWithDiagnostics({
      actor: "test-actor", source: "PULSE", snapshotId: snapshot.id, rows,
    })
    return { source, snapshot, entryIds: persisted.entryIds as string[] }
  }

  it("persists a batch of match results in one call and updates matched variant IDs", async () => {
    const { snapshot, entryIds } = await snapshotWithEntries(3)
    await service.recordSnapshotEntryMatches({
      actor: "test-actor", source: "PULSE", inventorySnapshotId: snapshot.id,
      entries: [
        { snapshotEntryId: entryIds[0], matchingStatus: "MATCHED", tradingCardVariantId: "tcvar_1", matchedVia: "TRUSTED_REFERENCE", diagnostics: [] },
        { snapshotEntryId: entryIds[1], matchingStatus: "UNMATCHED", tradingCardVariantId: null, matchedVia: "NONE", diagnostics: [] },
        { snapshotEntryId: entryIds[2], matchingStatus: "REVIEW_REQUIRED", tradingCardVariantId: null, matchedVia: "NONE", diagnostics: [
          { rowNumber: 3, phase: "MATCHING", code: "MATCHING_ATTRIBUTES_INCOMPLETE", severity: "INFO", message: "test" },
        ] },
      ],
    })
    const { rows } = await service.listSnapshotEntriesForAdmin(snapshot.id, {}, { limit: 10, offset: 0 })
    const matched = rows.find((row: Record<string, unknown>) => row.id === entryIds[0])
    expect(matched.trading_card_variant_id).toBeNull()
    expect(matched.matched_trading_card_variant_id).toBe("tcvar_1")
    expect(matched.matching_status).toBe("MATCHED")
    const { rows: diagnostics } = await service.listSnapshotEntryDiagnostics(snapshot.id, {}, { limit: 10, offset: 0 })
    expect(diagnostics).toHaveLength(1)
  })

  it("increments retry_count and never duplicates prior diagnostics on a repeat call", async () => {
    const { snapshot, entryIds } = await snapshotWithEntries(1)
    const item = { snapshotEntryId: entryIds[0], matchingStatus: "UNMATCHED", tradingCardVariantId: null, matchedVia: "NONE", diagnostics: [] }
    await service.recordSnapshotEntryMatches({ actor: "test-actor", source: "PULSE", inventorySnapshotId: snapshot.id, entries: [item] })
    await service.recordSnapshotEntryMatches({ actor: "test-actor", source: "PULSE", inventorySnapshotId: snapshot.id, entries: [item] })
    const { rows } = await service.listSnapshotEntriesForAdmin(snapshot.id, {}, { limit: 10, offset: 0 })
    expect(rows[0].retry_count).toBe(1)
  })

  it("rejects an entry ID that does not belong to the given snapshot", async () => {
    const { snapshot: snapshotA } = await snapshotWithEntries(1)
    const { entryIds: entryIdsB } = await snapshotWithEntries(1)
    await expect(service.recordSnapshotEntryMatches({
      actor: "test-actor", source: "PULSE", inventorySnapshotId: snapshotA.id,
      entries: [{ snapshotEntryId: entryIdsB[0], matchingStatus: "UNMATCHED", tradingCardVariantId: null, matchedVia: "NONE", diagnostics: [] }],
    })).rejects.toThrow(/not found/i)
  })

  it("atomically refreshes only affected pending proposals and blocks actioned proposals", async () => {
    const { source, snapshot, entryIds } = await snapshotWithEntries(2)
    const unmatchedEntries = entryIds.map((snapshotEntryId) => ({
      snapshotEntryId, matchingStatus: "UNMATCHED", tradingCardVariantId: null, matchedVia: "NONE", diagnostics: [],
    }))
    await service.recordSnapshotEntryMatches({
      actor: "test-actor", source: "PULSE", inventorySnapshotId: snapshot.id, entries: unmatchedEntries,
    })
    await service.transitionInventorySnapshotStatus({
      id: snapshot.id, targetStatus: "VALIDATED", actor: "test-actor", source: "PULSE",
    })
    await service.reconcileInventorySnapshot({
      inventorySourceId: source.id, snapshotId: snapshot.id, actor: "test-actor", source: "SYSTEM",
    })

    const before = await pgConnection("trading_card_inventory_proposal")
      .where({ inventory_snapshot_id: snapshot.id }).whereNull("deleted_at").orderBy("reconciliation_key")
    expect(before).toHaveLength(2)
    const affected = before.find((proposal) => proposal.provider_reference.includes("|0"))!
    const unaffected = before.find((proposal) => proposal.id !== affected.id)!
    const [{ count: holdingsBefore }] = await pgConnection("trading_card_inventory_holding")
      .where({ inventory_source_id: source.id }).whereNull("deleted_at").count<{ count: string }[]>("* as count")

    const diagnostic = {
      rowNumber: 1, phase: "MATCHING", code: "MATCH_RETRY_RESOLVED", severity: "INFO",
      fieldRef: "provider_reference", message: "Retry resolved the previously unmatched row",
    }
    await service.recordSnapshotEntryMatches({
      actor: "test-actor", source: "PULSE", reason: "new trusted reference", inventorySnapshotId: snapshot.id,
      refreshPendingProposals: true,
      entries: [{
        snapshotEntryId: entryIds[0], matchingStatus: "MATCHED", tradingCardVariantId: "tcvar_retry_1",
        matchedVia: "TRUSTED_REFERENCE", diagnostics: [diagnostic, diagnostic],
      }],
    })

    const after = await pgConnection("trading_card_inventory_proposal")
      .where({ inventory_snapshot_id: snapshot.id }).whereNull("deleted_at").orderBy("reconciliation_key")
    expect(after).toHaveLength(2)
    const refreshedAffected = after.find((proposal) => proposal.trading_card_variant_id === "tcvar_retry_1")!
    expect(refreshedAffected).toMatchObject({
      trading_card_variant_id: "tcvar_retry_1", change_kind: "NEW_HOLDING", review_status: "PENDING",
    })
    expect(refreshedAffected.id).not.toBe(affected.id)
    expect(await pgConnection("trading_card_inventory_proposal").where({ id: affected.id }).whereNotNull("deleted_at")).toHaveLength(1)
    expect(after.find((proposal) => proposal.id === unaffected.id)).toEqual(unaffected)
    expect(await pgConnection("trading_card_inventory_snapshot_entry_diagnostic")
      .where({ snapshot_entry_id: entryIds[0], code: "MATCH_RETRY_RESOLVED" }).whereNull("deleted_at")).toHaveLength(1)
    expect(await pgConnection("trading_card_inventory_audit_entry")
      .where({ entity_id: snapshot.id, action: "IMPORT_PROPOSALS_REFRESHED" })).toHaveLength(1)
    const [{ count: holdingsAfter }] = await pgConnection("trading_card_inventory_holding")
      .where({ inventory_source_id: source.id }).whereNull("deleted_at").count<{ count: string }[]>("* as count")
    expect(holdingsAfter).toBe(holdingsBefore)

    await service.transitionInventoryProposalStatus({
      id: refreshedAffected.id, targetStatus: "REJECTED", rejectionReason: "reviewed", actor: "reviewer", source: "MANUAL",
    })
    await expect(service.recordSnapshotEntryMatches({
      actor: "test-actor", source: "PULSE", inventorySnapshotId: snapshot.id, refreshPendingProposals: true,
      entries: [{
        snapshotEntryId: entryIds[0], matchingStatus: "UNMATCHED", tradingCardVariantId: null,
        matchedVia: "NONE", diagnostics: [],
      }],
    })).rejects.toThrow(/actioned/i)
    const [matchAfterRejectedRetry] = await pgConnection("trading_card_inventory_snapshot_entry_match")
      .where({ snapshot_entry_id: entryIds[0] }).whereNull("deleted_at")
    expect(matchAfterRejectedRetry).toMatchObject({ matching_status: "MATCHED", trading_card_variant_id: "tcvar_retry_1" })
  })
})
