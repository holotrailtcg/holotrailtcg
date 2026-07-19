import { MedusaError } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../../../modules/trading-cards"
import { TRADING_CARD_INVENTORY_MODULE } from "../../../modules/trading-card-inventory"
import { retryPulseSnapshotMatching } from "../retry-pulse-snapshot-matching"

function fakeInventory(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    retrieveInventorySnapshot: jest.fn()
      .mockResolvedValueOnce({ id: "tcisnap_1", inventory_source_id: "tcisrc_1", status: "DRAFT", row_count: 1 })
      .mockResolvedValue({ id: "tcisnap_1", inventory_source_id: "tcisrc_1", status: "VALIDATED", row_count: 1 }),
    retrieveInventorySource: jest.fn(async (id: string) => ({ id, status: "ACTIVE", language: "EN" })),
    listUnmatchedSnapshotEntriesForAdmin: jest.fn(async () => ([{
        id: "tcisentry_1", row_number: 1, outcome: "VALID", provider_reference: "card:sv1|066/196|holo|nm",
        quantity: 2, currency_code: "GBP", matching_status: "UNMATCHED",
      }])),
    recordSnapshotEntryMatches: jest.fn(async () => ({ inventorySnapshotId: "tcisnap_1", processedCount: 1 })),
    recordImportLifecycleAudit: jest.fn(async () => undefined),
    transitionInventorySnapshotStatus: jest.fn(async () => ({ id: "tcisnap_1" })),
    getSnapshotImportSummary: jest.fn()
      .mockResolvedValueOnce({
        snapshotId: "tcisnap_1", inventorySourceId: "tcisrc_1", status: "DRAFT", originalFilename: "f.csv",
        contentHash: "hash", rowCount: 1, byOutcome: { VALID: 1 }, byMatchingStatus: { MATCHED: 1 },
        byDiagnosticSeverity: {}, uniqueProviderReferences: 1, duplicateRowCount: 0,
      })
      .mockResolvedValue({
        snapshotId: "tcisnap_1", inventorySourceId: "tcisrc_1", status: "PENDING_REVIEW", originalFilename: "f.csv",
        contentHash: "hash", rowCount: 1, byOutcome: { VALID: 1 }, byMatchingStatus: { MATCHED: 1 },
        byDiagnosticSeverity: {}, uniqueProviderReferences: 1, duplicateRowCount: 0,
      }),
    listSnapshotEntryDiagnostics: jest.fn(async () => ({ rows: [], count: 0 })),
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

const baseInput = { actor: "user_1", source: "MANUAL" as const, snapshotId: "tcisnap_1" }

describe("retryPulseSnapshotMatching", () => {
  it("re-matches outstanding rows, transitions a DRAFT snapshot, and reaches reconciliation", async () => {
    const inventory = fakeInventory()
    const cards = fakeCards()
    const result = await retryPulseSnapshotMatching(fakeContainer(inventory, cards), baseInput)
    expect(result.kind).toBe("IMPORTED")
    expect(inventory.recordSnapshotEntryMatches).toHaveBeenCalledTimes(1)
    expect(inventory.transitionInventorySnapshotStatus).toHaveBeenCalledWith(expect.objectContaining({ targetStatus: "VALIDATED" }))
    expect(inventory.reconcileInventorySnapshot).toHaveBeenCalledTimes(1)
  })

  it("never invokes matching or the workflow's file/source resolution — only snapshot-scoped reads", async () => {
    const inventory = fakeInventory()
    const cards = fakeCards()
    await retryPulseSnapshotMatching(fakeContainer(inventory, cards), baseInput)
    expect(inventory.retrieveInventorySnapshot).toHaveBeenCalledWith("tcisnap_1")
    expect(inventory.retrieveInventorySource).toHaveBeenCalledWith("tcisrc_1")
  })

  it("does not re-transition or reconcile a snapshot already past DRAFT with nothing left to match", async () => {
    const inventory = fakeInventory({
      retrieveInventorySnapshot: jest.fn(async (id: string) => ({
        id, inventory_source_id: "tcisrc_1", status: "PENDING_REVIEW", row_count: 1,
      })),
      listUnmatchedSnapshotEntriesForAdmin: jest.fn(async () => []),
    })
    const cards = fakeCards()
    const result = await retryPulseSnapshotMatching(fakeContainer(inventory, cards), baseInput)
    expect(result.kind).toBe("IMPORTED")
    expect(inventory.transitionInventorySnapshotStatus).not.toHaveBeenCalled()
    expect(inventory.recordSnapshotEntryMatches).not.toHaveBeenCalled()
    expect(inventory.getReconciliationSummary).toHaveBeenCalledTimes(1)
  })

  it("rejects retrying a snapshot with no persisted entries", async () => {
    const inventory = fakeInventory({
      retrieveInventorySnapshot: jest.fn(async (id: string) => ({
        id, inventory_source_id: "tcisrc_1", status: "DRAFT", row_count: 0,
      })),
    })
    const cards = fakeCards()
    await expect(retryPulseSnapshotMatching(fakeContainer(inventory, cards), baseInput)).rejects.toThrow(MedusaError)
  })

  it.each(["FAILED", "REJECTED", "APPLIED", "SUPERSEDED"])("rejects terminal snapshot status %s", async (status) => {
    const inventory = fakeInventory({
      retrieveInventorySnapshot: jest.fn(async (id: string) => ({
        id, inventory_source_id: "tcisrc_1", status, row_count: 1,
      })),
    })
    await expect(retryPulseSnapshotMatching(fakeContainer(inventory, fakeCards()), baseInput)).rejects.toThrow(/status/i)
    expect(inventory.recordSnapshotEntryMatches).not.toHaveBeenCalled()
  })

  it("refreshes pending proposals as part of the match write", async () => {
    const inventory = fakeInventory({
      retrieveInventorySnapshot: jest.fn(async (id: string) => ({
        id, inventory_source_id: "tcisrc_1", status: "PENDING_REVIEW", row_count: 1,
        reconciled_against_snapshot_id: "tcisnap_baseline",
      })),
    })
    await retryPulseSnapshotMatching(fakeContainer(inventory, fakeCards()), baseInput)
    expect(inventory.recordSnapshotEntryMatches).toHaveBeenCalledWith(expect.objectContaining({
      refreshPendingProposals: true,
      inventorySnapshotId: "tcisnap_1",
    }))
    expect(inventory.transitionInventorySnapshotStatus).not.toHaveBeenCalled()
  })

  it("re-matches every underlying duplicate entry instead of one grouped display row", async () => {
    const inventory = fakeInventory({
      listUnmatchedSnapshotEntriesForAdmin: jest.fn(async () => [
        {
          id: "tcisentry_1", row_number: 1, outcome: "VALID", provider_reference: "card:sv1|066/196|holo|nm",
          quantity: 1, currency_code: "GBP", matching_status: "UNMATCHED",
        },
        {
          id: "tcisentry_2", row_number: 2, outcome: "VALID", provider_reference: "card:sv1|066/196|holo|nm",
          quantity: 1, currency_code: "GBP", matching_status: "UNMATCHED",
        },
      ]),
    })

    await retryPulseSnapshotMatching(fakeContainer(inventory, fakeCards()), baseInput)

    expect(inventory.recordSnapshotEntryMatches).toHaveBeenCalledWith(expect.objectContaining({
      entries: expect.arrayContaining([
        expect.objectContaining({ snapshotEntryId: "tcisentry_1" }),
        expect.objectContaining({ snapshotEntryId: "tcisentry_2" }),
      ]),
    }))
  })

  it("returns NO_USABLE_ROWS and skips reconciliation when a DRAFT snapshot still has no usable rows", async () => {
    const inventory = fakeInventory({
      getSnapshotImportSummary: jest.fn(async () => ({
        snapshotId: "tcisnap_1", inventorySourceId: "tcisrc_1", status: "DRAFT", originalFilename: "f.csv",
        contentHash: "hash", rowCount: 1, byOutcome: { INVALID: 1 }, byMatchingStatus: {}, byDiagnosticSeverity: {},
        uniqueProviderReferences: 1, duplicateRowCount: 0,
      })),
    })
    const cards = fakeCards()
    const result = await retryPulseSnapshotMatching(fakeContainer(inventory, cards), baseInput)
    expect(result).toEqual({ kind: "NO_USABLE_ROWS", snapshotId: "tcisnap_1", inventorySourceId: "tcisrc_1", snapshotStatus: "FAILED" })
    expect(inventory.reconcileInventorySnapshot).not.toHaveBeenCalled()
  })
})
