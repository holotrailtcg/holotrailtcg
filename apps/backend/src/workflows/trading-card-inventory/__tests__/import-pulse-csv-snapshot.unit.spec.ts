import { MedusaError } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../../../modules/trading-cards"
import { TRADING_CARD_INVENTORY_MODULE } from "../../../modules/trading-card-inventory"
import { importPulseCsvSnapshot } from "../import-pulse-csv-snapshot"

const VALID_CSV_HEADER =
  "Product Name,Set,Card Number,Material,Promo Info,Rarity,Graded By,Grade,Item Type,Product ID,Quantity,Avg Cost,Market Price,Sticker Price,Total Cost,Total Market Value,Total Sticker Value,Profit,Margin %,Markup vs Market %"
const VALID_CSV_ROW =
  "Gengar,Lost Origin,066/196,Holo,,Rare,,,,card:sv1|066/196|holo|nm,2,1.50,3.00,4.00,3.00,6.00,8.00,5.00,50%"

function csvBuffer(rows: string[] = [VALID_CSV_ROW]): Buffer {
  return Buffer.from([VALID_CSV_HEADER, ...rows].join("\n"), "utf-8")
}

function fakeInventory(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    retrieveInventorySource: jest.fn(async (id: string) => ({ id, status: "ACTIVE", language: "EN" })),
    retrieveInventorySnapshot: jest.fn(async (id: string) => ({ id, inventory_source_id: "tcisrc_1", status: "VALIDATED", row_count: 1 })),
    createOrGetInventorySource: jest.fn(async () => ({ source: { id: "tcisrc_new", status: "ACTIVE", language: "EN" }, created: true })),
    findLiveSnapshotByContentHash: jest.fn(async () => null),
    createDraftSnapshot: jest.fn(async () => ({ id: "tcisnap_1" })),
    recordImportLifecycleAudit: jest.fn(async () => undefined),
    addInventorySnapshotEntriesWithDiagnostics: jest.fn(async (input: { rows: unknown[] }) => ({
      snapshotId: "tcisnap_1", addedCount: input.rows.length, entryIds: input.rows.map((_, index) => `tcisentry_${index}`),
    })),
    recordSnapshotEntryMatches: jest.fn(async () => ({ inventorySnapshotId: "tcisnap_1", processedCount: 1 })),
    transitionInventorySnapshotStatus: jest.fn(async () => ({ id: "tcisnap_1" })),
    getSnapshotImportSummary: jest.fn(async () => ({
      snapshotId: "tcisnap_1", inventorySourceId: "tcisrc_1", status: "PENDING_REVIEW", originalFilename: "f.csv",
      contentHash: "hash", rowCount: 1, byOutcome: { VALID: 1 }, byMatchingStatus: { MATCHED: 1 },
      byDiagnosticSeverity: {}, uniqueProviderReferences: 1, duplicateRowCount: 0,
    })),
    listSnapshotEntryDiagnostics: jest.fn(async () => ({ rows: [], count: 0 })),
    listSnapshotEntriesForAdmin: jest.fn(async () => ({ rows: [], count: 0 })),
    listSnapshotVariantIds: jest.fn(async () => []),
    reconcileInventorySnapshot: jest.fn(async () => ({
      snapshotId: "tcisnap_1", inventorySourceId: "tcisrc_1", status: "PENDING_REVIEW",
      baselineSnapshotId: null, comparedAt: new Date(), proposalCount: 1, proposalCounts: { NEW_HOLDING: 1 },
    })),
    getReconciliationSummary: jest.fn(async () => ({
      snapshotId: "tcisnap_1", inventorySourceId: "tcisrc_1", status: "PENDING_REVIEW",
      baselineSnapshotId: null, comparedAt: new Date(), proposalCount: 1, proposalCounts: { NEW_HOLDING: 1 },
    })),
    ...overrides,
  }
}

function fakeCards(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    findTrustedExternalReference: jest.fn(async () => null),
    findVariantCandidatesForPulseMatch: jest.fn(async () => []),
    retrieveTradingCardVariant: jest.fn(async (id: string) => ({ id, trading_card_id: "tcard_1" })),
    upsertExternalReference: jest.fn(async () => ({})),
    listTradingCardVariants: jest.fn(async () => []),
    ...overrides,
  }
}

function fakeContainer(inventory: ReturnType<typeof fakeInventory>, cards: ReturnType<typeof fakeCards>) {
  return {
    resolve: jest.fn((key: string) => {
      if (key === TRADING_CARD_INVENTORY_MODULE) return inventory
      if (key === TRADING_CARDS_MODULE) return cards
      throw new Error(`Unexpected resolve key: ${key}`)
    }),
  } as never
}

const baseInput = {
  actor: "user_1", source: "PULSE" as const,
  originalFilename: "import.csv", mimeType: "text/csv", fileBuffer: csvBuffer(),
  inventorySourceId: "tcisrc_1",
}

describe("importPulseCsvSnapshot", () => {
  it("imports a fresh upload against an existing active source through to reconciliation", async () => {
    const inventory = fakeInventory({
      getSnapshotImportSummary: jest.fn()
        .mockResolvedValueOnce({ status: "DRAFT", byOutcome: { VALID: 1 } })
        .mockResolvedValue({
          snapshotId: "tcisnap_1", inventorySourceId: "tcisrc_1", status: "PENDING_REVIEW", originalFilename: "f.csv",
          contentHash: "hash", rowCount: 1, byOutcome: { VALID: 1 }, byMatchingStatus: { MATCHED: 1 },
          byDiagnosticSeverity: {}, uniqueProviderReferences: 1, duplicateRowCount: 0,
        }),
    })
    const cards = fakeCards()
    const result = await importPulseCsvSnapshot(fakeContainer(inventory, cards), baseInput)
    expect(result.kind).toBe("IMPORTED")
    expect(inventory.createDraftSnapshot).toHaveBeenCalledTimes(1)
    expect(inventory.addInventorySnapshotEntriesWithDiagnostics).toHaveBeenCalledTimes(1)
    expect(inventory.recordSnapshotEntryMatches).toHaveBeenCalledTimes(1)
    expect(inventory.transitionInventorySnapshotStatus).toHaveBeenCalledWith(expect.objectContaining({ targetStatus: "VALIDATED" }))
    expect(inventory.reconcileInventorySnapshot).toHaveBeenCalledTimes(1)
  })

  it("creates a new source when no inventorySourceId is given", async () => {
    const inventory = fakeInventory()
    const cards = fakeCards()
    const input = { ...baseInput, inventorySourceId: undefined, newSourceDisplayName: "Pulse Export", newSourceProvider: "PULSE" }
    const result = await importPulseCsvSnapshot(fakeContainer(inventory, cards), input)
    expect(result.kind).toBe("IMPORTED")
    expect(inventory.createOrGetInventorySource).toHaveBeenCalledTimes(1)
  })

  it("rejects source selection input that supplies neither an existing id nor a full new-source spec", async () => {
    const inventory = fakeInventory()
    const cards = fakeCards()
    const input = { ...baseInput, inventorySourceId: undefined, newSourceDisplayName: "Pulse Export" }
    await expect(importPulseCsvSnapshot(fakeContainer(inventory, cards), input)).rejects.toThrow(MedusaError)
    expect(inventory.findLiveSnapshotByContentHash).not.toHaveBeenCalled()
  })

  it("rejects supplying both source-selection paths", async () => {
    const inventory = fakeInventory()
    const input = { ...baseInput, newSourceDisplayName: "Also New", newSourceProvider: "PULSE" }
    await expect(importPulseCsvSnapshot(fakeContainer(inventory, fakeCards()), input)).rejects.toThrow(/exactly one/i)
    expect(inventory.retrieveInventorySource).not.toHaveBeenCalled()
    expect(inventory.createOrGetInventorySource).not.toHaveBeenCalled()
  })

  it("short-circuits to SOURCE_ARCHIVED and never touches file validation or snapshot creation", async () => {
    const inventory = fakeInventory({
      retrieveInventorySource: jest.fn(async (id: string) => ({ id, status: "ARCHIVED", language: "EN" })),
    })
    const cards = fakeCards()
    const result = await importPulseCsvSnapshot(fakeContainer(inventory, cards), baseInput)
    expect(result).toEqual({ kind: "SOURCE_ARCHIVED", inventorySourceId: "tcisrc_1" })
    expect(inventory.findLiveSnapshotByContentHash).not.toHaveBeenCalled()
    expect(inventory.createDraftSnapshot).not.toHaveBeenCalled()
  })

  it("returns VALIDATION_FAILED for an unsupported MIME type before any snapshot work happens", async () => {
    const inventory = fakeInventory()
    const cards = fakeCards()
    const input = { ...baseInput, mimeType: "application/pdf" }
    const result = await importPulseCsvSnapshot(fakeContainer(inventory, cards), input)
    expect(result.kind).toBe("VALIDATION_FAILED")
    expect(inventory.findLiveSnapshotByContentHash).not.toHaveBeenCalled()
    expect(inventory.createDraftSnapshot).not.toHaveBeenCalled()
  })

  it("does not create a new source when file validation fails", async () => {
    const inventory = fakeInventory()
    const input = {
      ...baseInput, inventorySourceId: undefined, newSourceDisplayName: "Unused Source", newSourceProvider: "PULSE",
      mimeType: "application/pdf",
    }
    const result = await importPulseCsvSnapshot(fakeContainer(inventory, fakeCards()), input)
    expect(result.kind).toBe("VALIDATION_FAILED")
    expect(inventory.createOrGetInventorySource).not.toHaveBeenCalled()
  })

  it("returns VALIDATION_FAILED for a missing required header", async () => {
    const inventory = fakeInventory()
    const cards = fakeCards()
    const input = { ...baseInput, fileBuffer: Buffer.from("Product Name,Set\nGengar,Lost Origin", "utf-8") }
    const result = await importPulseCsvSnapshot(fakeContainer(inventory, cards), input)
    expect(result.kind).toBe("VALIDATION_FAILED")
  })

  it("maps a pre-check content-hash hit to DUPLICATE and skips every later phase", async () => {
    const inventory = fakeInventory({
      findLiveSnapshotByContentHash: jest.fn(async () => ({ id: "tcisnap_existing", status: "PENDING_REVIEW" })),
    })
    const cards = fakeCards()
    const result = await importPulseCsvSnapshot(fakeContainer(inventory, cards), baseInput)
    expect(result).toMatchObject({ kind: "DUPLICATE", snapshotId: "tcisnap_existing" })
    expect(inventory.createDraftSnapshot).not.toHaveBeenCalled()
    expect(inventory.addInventorySnapshotEntriesWithDiagnostics).not.toHaveBeenCalled()
    expect(inventory.recordSnapshotEntryMatches).not.toHaveBeenCalled()
    expect(inventory.transitionInventorySnapshotStatus).not.toHaveBeenCalled()
    expect(inventory.reconcileInventorySnapshot).not.toHaveBeenCalled()
  })

  it("maps a race-window DuplicateSnapshotError from createDraftSnapshot to the same DUPLICATE result", async () => {
    const { DuplicateSnapshotError } = jest.requireActual("../../../modules/trading-card-inventory/service")
    const inventory = fakeInventory({
      createDraftSnapshot: jest.fn(async () => { throw new DuplicateSnapshotError("tcisnap_raced") }),
    })
    const cards = fakeCards()
    const result = await importPulseCsvSnapshot(fakeContainer(inventory, cards), baseInput)
    expect(result).toMatchObject({ kind: "DUPLICATE", snapshotId: "tcisnap_raced" })
    expect(inventory.addInventorySnapshotEntriesWithDiagnostics).not.toHaveBeenCalled()
  })

  it("resumes a partially persisted DRAFT duplicate", async () => {
    const inventory = fakeInventory({
      findLiveSnapshotByContentHash: jest.fn(async () => ({ id: "tcisnap_1", status: "DRAFT" })),
      getSnapshotImportSummary: jest.fn()
        .mockResolvedValueOnce({ status: "DRAFT" })
        .mockResolvedValue({
          snapshotId: "tcisnap_1", inventorySourceId: "tcisrc_1", status: "PENDING_REVIEW", originalFilename: "f.csv",
          contentHash: "hash", rowCount: 1, byOutcome: { VALID: 1 }, byMatchingStatus: { UNMATCHED: 1 },
          byDiagnosticSeverity: {}, uniqueProviderReferences: 1, duplicateRowCount: 0,
        }),
    })
    const result = await importPulseCsvSnapshot(fakeContainer(inventory, fakeCards()), baseInput)
    expect(result.kind).toBe("IMPORTED")
    expect(inventory.createDraftSnapshot).not.toHaveBeenCalled()
    expect(inventory.addInventorySnapshotEntriesWithDiagnostics).toHaveBeenCalledTimes(1)
  })

  it("continues a VALIDATED duplicate through file-free retry", async () => {
    const inventory = fakeInventory({
      findLiveSnapshotByContentHash: jest.fn(async () => ({ id: "tcisnap_1", status: "VALIDATED" })),
      getSnapshotImportSummary: jest.fn()
        .mockResolvedValueOnce({ status: "VALIDATED" })
        .mockResolvedValue({
          snapshotId: "tcisnap_1", inventorySourceId: "tcisrc_1", status: "PENDING_REVIEW", originalFilename: "f.csv",
          contentHash: "hash", rowCount: 1, byOutcome: { VALID: 1 }, byMatchingStatus: { MATCHED: 1 },
          byDiagnosticSeverity: {}, uniqueProviderReferences: 1, duplicateRowCount: 0,
        }),
    })
    const result = await importPulseCsvSnapshot(fakeContainer(inventory, fakeCards()), baseInput)
    expect(result.kind).toBe("IMPORTED")
    expect(inventory.addInventorySnapshotEntriesWithDiagnostics).not.toHaveBeenCalled()
    expect(inventory.reconcileInventorySnapshot).toHaveBeenCalledTimes(1)
  })

  it("moves a snapshot with zero usable rows to FAILED and never invokes reconciliation", async () => {
    const inventory = fakeInventory({
      getSnapshotImportSummary: jest.fn(async () => ({
        snapshotId: "tcisnap_1", inventorySourceId: "tcisrc_1", status: "DRAFT", originalFilename: "f.csv",
        contentHash: "hash", rowCount: 1, byOutcome: { INVALID: 1 }, byMatchingStatus: {}, byDiagnosticSeverity: {},
        uniqueProviderReferences: 1, duplicateRowCount: 0,
      })),
    })
    const cards = fakeCards()
    const result = await importPulseCsvSnapshot(fakeContainer(inventory, cards), baseInput)
    expect(result).toEqual({ kind: "NO_USABLE_ROWS", snapshotId: "tcisnap_1", inventorySourceId: "tcisrc_1", snapshotStatus: "FAILED" })
    expect(inventory.transitionInventorySnapshotStatus).toHaveBeenCalledWith(expect.objectContaining({ targetStatus: "FAILED" }))
    expect(inventory.reconcileInventorySnapshot).not.toHaveBeenCalled()
  })
})
