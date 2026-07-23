import { TRADING_CARD_INVENTORY_MODULE } from "../../../modules/trading-card-inventory"
import { TRADING_CARDS_MODULE } from "../../../modules/trading-cards"
import { TCGDEX_ERROR_CODE, TcgDexError } from "../../../modules/trading-cards/tcgdex/errors"

const matchTcgdexCardMock = jest.fn()
jest.mock("../../../modules/trading-cards/tcgdex", () => ({
  matchTcgdexCard: (...args: unknown[]) => matchTcgdexCardMock(...args),
  matchesLocalIdentity: (localCardNumber: string, providerLocalId: string) => localCardNumber === providerLocalId,
}))

const resolveTcgDexAdminClientMock = jest.fn()
jest.mock("../../../api/admin/tcgdex/dependencies", () => ({
  resolveTcgDexAdminClient: (...args: unknown[]) => resolveTcgDexAdminClientMock(...args),
}))

import { processTcgdexLookupBatch } from "../process-tcgdex-lookup-batch"

function fakeContainer(options: {
  providerReferences?: string[]
  existingCandidates?: Array<{ tcgdex_set_id: string; card_number: string }>
}) {
  const inventory = {
    getSnapshotImportSummary: jest.fn(async () => ({ inventorySourceLanguage: "EN" })),
    listDistinctUnmatchedProviderReferences: jest.fn(async () => options.providerReferences ?? ["card:sv1|066/196|holo|nm"]),
  }
  const cards = {
    findProviderSetMapping: jest.fn(async () => ({ tcgdex_set_id: "sv1" })),
    listTcgdexLookupCandidates: jest.fn(async () => options.existingCandidates ?? []),
    recordTcgdexLookupCandidate: jest.fn(async () => undefined),
  }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === TRADING_CARD_INVENTORY_MODULE) return inventory
      if (key === TRADING_CARDS_MODULE) return cards
      throw new Error(`Unexpected resolve key: ${key}`)
    }),
  }
  return { container: container as never, inventory, cards }
}

describe("processTcgdexLookupBatch — fallback-search transient-failure caching", () => {
  beforeEach(() => {
    matchTcgdexCardMock.mockReset()
    resolveTcgDexAdminClientMock.mockReset()
  })

  it("does not cache NO_MATCH when the set-scoped fallback search fails transiently (must remain retryable)", async () => {
    const { container, cards } = fakeContainer({})
    matchTcgdexCardMock.mockResolvedValue({ code: "NO_MATCH" })
    resolveTcgDexAdminClientMock.mockReturnValue({
      getSetById: jest.fn(async () => {
        throw new TcgDexError({ code: TCGDEX_ERROR_CODE.TIMEOUT, operation: "matching-response", message: "timed out" })
      }),
    })

    const result = await processTcgdexLookupBatch(container, { snapshotId: "tcisnap_1", batchSize: 10 })

    expect(cards.recordTcgdexLookupCandidate).not.toHaveBeenCalled()
    expect(result.processedThisBatch).toBe(0)
    expect(result.remaining).toBe(1)
  })

  it("caches NO_MATCH when the set-scoped fallback search fails with a stable NOT_FOUND (the set genuinely doesn't exist)", async () => {
    const { container, cards } = fakeContainer({})
    matchTcgdexCardMock.mockResolvedValue({ code: "NO_MATCH" })
    resolveTcgDexAdminClientMock.mockReturnValue({
      getSetById: jest.fn(async () => {
        throw new TcgDexError({ code: TCGDEX_ERROR_CODE.NOT_FOUND, operation: "matching-response", message: "not found" })
      }),
    })

    const result = await processTcgdexLookupBatch(container, { snapshotId: "tcisnap_1", batchSize: 10 })

    expect(cards.recordTcgdexLookupCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ matchOutcome: "NO_MATCH" }),
    )
    expect(result.processedThisBatch).toBe(1)
  })

  it("caches AMBIGUOUS when the set-scoped fallback search succeeds and finds loosely-matching cards", async () => {
    const { container, cards } = fakeContainer({})
    matchTcgdexCardMock.mockResolvedValue({ code: "NO_MATCH" })
    resolveTcgDexAdminClientMock.mockReturnValue({
      getSetById: jest.fn(async () => ({
        cards: [{ id: "sv1-066", localId: "066", name: "Gengar", image: null }],
      })),
    })

    const result = await processTcgdexLookupBatch(container, { snapshotId: "tcisnap_1", batchSize: 10 })

    expect(cards.recordTcgdexLookupCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ matchOutcome: "AMBIGUOUS" }),
    )
    expect(result.processedThisBatch).toBe(1)
  })
})
