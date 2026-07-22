import { TRADING_CARDS_MODULE } from "../../../modules/trading-cards"
import { TRADING_CARD_INVENTORY_MODULE } from "../../../modules/trading-card-inventory"

const runMock = jest.fn()
jest.mock("../../trading-cards/create-card-from-inventory-row", () => ({
  createCardFromInventoryRowWorkflow: jest.fn(() => ({ run: runMock })),
}))
jest.mock("../pulse-import-shared", () => ({
  retryPulseSnapshotMatching: jest.fn(async () => undefined),
}))

import { bulkReviewTcgdexCandidates } from "../bulk-review-tcgdex-candidates"

const CANDIDATE_ID = "tclookup_1"

function fakeCandidate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CANDIDATE_ID, match_outcome: "MATCHED", review_status: "PENDING",
    card_number: "066", tcgdex_set_id: "set_1",
    enrichment: { name: "Gengar", variants: { normal: true, holo: false, reverse: false } },
    ...overrides,
  }
}

function fakeEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    provider_reference: "card:sv1|066/196|holo|nm",
    finish_candidate: "HOLO", special_treatment_candidate: "NONE", condition_candidate: "NEAR_MINT",
    rarity_raw: "Rare",
    ...overrides,
  }
}

function fakeContainer(options: {
  candidate?: Partial<Record<string, unknown>>
  entries?: Partial<Record<string, unknown>>[]
  mapping?: Partial<Record<string, unknown>> | null
} = {}) {
  const cards = {
    retrieveTcgdexLookupCandidateById: jest.fn(async () => options.candidate === null ? null : fakeCandidate(options.candidate)),
    reviewTcgdexLookupCandidates: jest.fn(async () => undefined),
    findProviderSetMapping: jest.fn(async () => options.mapping === undefined
      ? { tcgdex_set_id: "set_1", tcgdex_set_name: "Ascended Heroes" }
      : options.mapping),
    recordTcgdexMatchResult: jest.fn(async () => undefined),
  }
  const inventory = {
    getSnapshotImportSummary: jest.fn(async () => ({ inventorySourceLanguage: "EN" })),
    listUnmatchedSnapshotEntriesForAdmin: jest.fn(async () => (options.entries ?? [fakeEntry()]).map((e) => fakeEntry(e))),
    listAndCountInventoryProposals: jest.fn(async () => [[{ id: "tciprop_1" }], 1]),
    beginCardCreationClaim: jest.fn(async () => ({ claimToken: "claim_1", alreadyResolved: false })),
  }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === TRADING_CARDS_MODULE) return cards
      if (key === TRADING_CARD_INVENTORY_MODULE) return inventory
      throw new Error(`Unexpected resolve key: ${key}`)
    }),
  }
  return { container: container as never, cards, inventory }
}

describe("bulkReviewTcgdexCandidates", () => {
  beforeEach(() => {
    runMock.mockReset()
  })

  it("REJECT marks every candidate REJECTED without touching inventory rows", async () => {
    const { container, cards, inventory } = fakeContainer()
    const result = await bulkReviewTcgdexCandidates(container, {
      actor: "reviewer", snapshotId: "tcisnap_1", candidateIds: [CANDIDATE_ID, "tclookup_2"], action: "REJECT",
    })
    expect(cards.reviewTcgdexLookupCandidates).toHaveBeenCalledWith({ ids: [CANDIDATE_ID, "tclookup_2"], reviewStatus: "REJECTED" })
    expect(inventory.listUnmatchedSnapshotEntriesForAdmin).not.toHaveBeenCalled()
    expect(result.results).toEqual([
      { candidateId: CANDIDATE_ID, createdVariantCount: 0, skippedRowCount: 0, errors: [] },
      { candidateId: "tclookup_2", createdVariantCount: 0, skippedRowCount: 0, errors: [] },
    ])
  })

  it("surfaces the real message from a thrown plain object (not a real Error instance) rather than a generic fallback", async () => {
    // The workflow engine's transaction orchestrator round-trips a failed step's
    // error through its own checkpoint state before `.run()` rethrows it, which
    // does not preserve the original error's prototype chain — simulate that
    // here with a plain object carrying only a `.message`, not `instanceof Error`.
    const notARealError = { message: "This SKU is already in use by another product." }
    expect(notARealError instanceof Error).toBe(false)
    runMock.mockRejectedValueOnce(notARealError)

    const { container } = fakeContainer()
    const result = await bulkReviewTcgdexCandidates(container, {
      actor: "reviewer", snapshotId: "tcisnap_1", candidateIds: [CANDIDATE_ID], action: "ACCEPT",
    })

    expect(result.results).toHaveLength(1)
    expect(result.results[0].errors).toEqual([
      "card:sv1|066/196|holo|nm: This SKU is already in use by another product.",
    ])
  })

  it("falls back to String(error) when the thrown value has no .message at all", async () => {
    runMock.mockRejectedValueOnce("a bare string failure")

    const { container } = fakeContainer()
    const result = await bulkReviewTcgdexCandidates(container, {
      actor: "reviewer", snapshotId: "tcisnap_1", candidateIds: [CANDIDATE_ID], action: "ACCEPT",
    })

    expect(result.results[0].errors).toEqual(["card:sv1|066/196|holo|nm: a bare string failure"])
  })

  it("creates a variant and marks the candidate ACCEPTED when the create workflow succeeds", async () => {
    runMock.mockResolvedValueOnce({ result: { tradingCardId: "tcard_1", tradingCardVariantId: "tcvar_1" } })
    const { container, cards } = fakeContainer()

    const result = await bulkReviewTcgdexCandidates(container, {
      actor: "reviewer", snapshotId: "tcisnap_1", candidateIds: [CANDIDATE_ID], action: "ACCEPT",
    })

    expect(result.results[0]).toMatchObject({ candidateId: CANDIDATE_ID, createdVariantCount: 1, skippedRowCount: 0, errors: [] })
    expect(cards.reviewTcgdexLookupCandidates).toHaveBeenCalledWith({ ids: [CANDIDATE_ID], reviewStatus: "ACCEPTED" })
  })

  it("leaves the candidate retryable (not ACCEPTED) when any of its rows fail to create", async () => {
    runMock.mockRejectedValueOnce({ message: "boom" })
    const { container, cards } = fakeContainer()

    await bulkReviewTcgdexCandidates(container, {
      actor: "reviewer", snapshotId: "tcisnap_1", candidateIds: [CANDIDATE_ID], action: "ACCEPT",
    })

    expect(cards.reviewTcgdexLookupCandidates).not.toHaveBeenCalled()
  })
})
