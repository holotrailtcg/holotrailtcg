import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection } from "@medusajs/framework/utils"
import { TRADING_CARD_INVENTORY_MODULE } from "../index"
import { Migration20260716190000 } from "../migrations/Migration20260716190000"
import { DuplicateSnapshotError } from "../service"

let pgConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let service: any

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

async function applyMigration(migrationClass: new (a: never, b: never) => { up(): Promise<void>; getQueries(): unknown[] }) {
  const migration = new migrationClass(undefined as never, undefined as never)
  await migration.up()
  for (const query of migration.getQueries().map(String)) await pgConnection.raw(query)
}

beforeAll(async () => {
  pgConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  // Only the newest migration this slice adds is re-applied here (matching
  // the existing single-migration convention in this test suite) — earlier
  // migrations (150000/180000) are assumed already applied via a normal
  // `db:migrate` run and must not be blindly re-run here: their `up()`
  // unconditionally re-narrows the audit-action CHECK constraint, which
  // fails once any row uses a newer action value this constraint doesn't
  // yet know about.
  await applyMigration(Migration20260716190000)
  medusaApp = await MedusaApp({
    modulesConfig: { [TRADING_CARD_INVENTORY_MODULE]: { resolve: "./src/modules/trading-card-inventory" } },
    injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection },
    cwd: process.cwd(),
  })
  await medusaApp.onApplicationStart()
  service = medusaApp.modules[TRADING_CARD_INVENTORY_MODULE]
}, 60000)

afterAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (pgConnection as any)?.context?.destroy()
  await pgConnection?.destroy()
  await medusaApp?.onApplicationPrepareShutdown()
  await medusaApp?.onApplicationShutdown()
})

async function createSource(overrides: Record<string, unknown> = {}) {
  const id = suffix()
  return service.createInventorySource({
    displayName: `Pulse Import Test Source ${id}`, provider: "PULSE", actor: "test-actor", source: "MANUAL", ...overrides,
  })
}

describe("createOrGetInventorySource", () => {
  it("creates a new source when no equivalent name exists", async () => {
    const id = suffix()
    const result = await service.createOrGetInventorySource({
      displayName: `Fresh Source ${id}`, provider: "PULSE", actor: "test-actor", source: "PULSE",
    })
    expect(result.created).toBe(true)
    expect(result.source.status).toBe("ACTIVE")
  })

  it("returns the existing active source instead of throwing on a repeat call", async () => {
    const id = suffix()
    const displayName = `Repeat Source ${id}`
    const first = await service.createOrGetInventorySource({ displayName, provider: "PULSE", actor: "test-actor", source: "PULSE" })
    const second = await service.createOrGetInventorySource({ displayName, provider: "PULSE", actor: "test-actor", source: "PULSE" })
    expect(second.created).toBe(false)
    expect(second.source.id).toBe(first.source.id)
  })

  it("refuses to resolve an archived source", async () => {
    const source = await createSource()
    await service.archiveInventorySource({ id: source.id, actor: "test-actor", source: "MANUAL" })
    await expect(service.createOrGetInventorySource({
      displayName: source.display_name, provider: "PULSE", actor: "test-actor", source: "PULSE",
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
    expect(matched.trading_card_variant_id).toBe("tcvar_1")
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
})
