import { TRADING_CARDS_MODULE } from "../../../modules/trading-cards"
import { TRADING_CARD_INVENTORY_MODULE } from "../../../modules/trading-card-inventory"
import { EBAY_INTEGRATION_MODULE } from "../../../modules/ebay-integration"

import { recomputeProposalCategoriesForSnapshot } from "../recompute-proposal-categories"

function fakeProposal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "tciprop_1", change_kind: "NEW_HOLDING", review_status: "PENDING",
    confirmed_ebay_store_category_id: null, provider_reference: "card:sv1|066/196|holo|nm",
    trading_card_variant_id: "tcvar_1",
    ...overrides,
  }
}

function fakeContainer(options: {
  proposals?: Partial<Record<string, unknown>>[]
  connections?: Array<{ status: string; environment: string }>
  evaluationResult: { storeCategoryId: string | null; reason: string; matchedRuleId: string | null; outcome: string }
}) {
  const inventory = {
    listInventoryProposals: jest.fn(async () => options.proposals ?? [fakeProposal()]),
    retrieveInventorySnapshot: jest.fn(async () => ({ inventory_source_id: "tcisrc_1" })),
    retrieveInventorySource: jest.fn(async () => ({ language: "EN" })),
    listSnapshotEntriesForAdmin: jest.fn(async () => ({ rows: [{ finish_candidate: "HOLO", special_treatment_candidate: "NONE", rarity_candidate: "RARE" }] })),
    setProposedCategoryAssignment: jest.fn(async () => undefined),
    confirmProposalCategory: jest.fn(async () => undefined),
  }
  const cards = { listTradingCardVariants: jest.fn(async () => []) }
  const ebayIntegration = {
    listSafeConnections: jest.fn(async () => options.connections ?? [{ status: "CONNECTED", environment: "SANDBOX" }]),
    evaluateCategoryAssignment: jest.fn(async () => options.evaluationResult),
  }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === TRADING_CARD_INVENTORY_MODULE) return inventory
      if (key === TRADING_CARDS_MODULE) return cards
      if (key === EBAY_INTEGRATION_MODULE) return ebayIntegration
      throw new Error(`Unexpected resolve key: ${key}`)
    }),
  }
  return { container: container as never, inventory, ebayIntegration }
}

describe("recomputeProposalCategoriesForSnapshot", () => {
  it("re-evaluates every unconfirmed proposal and auto-confirms a fresh rule match", async () => {
    const { container, inventory } = fakeContainer({
      evaluationResult: { storeCategoryId: "ebcat_1", reason: "Matched rule \"Holo singles\"", matchedRuleId: "ebrule_1", outcome: "RULE_MATCH" },
    })

    const { recomputedCount, results } = await recomputeProposalCategoriesForSnapshot(container, { snapshotId: "tcisnap_1" })

    expect(recomputedCount).toBe(1)
    expect(results[0].result.outcome).toBe("RULE_MATCH")
    expect(inventory.confirmProposalCategory).toHaveBeenCalledWith({
      proposalId: "tciprop_1", storeCategoryId: "ebcat_1", actor: "system:category-rule-auto-confirm", source: "SYSTEM", requireUnconfirmed: true,
    })
  })

  it("excludes already-confirmed and non-in-scope proposals from the recompute set", async () => {
    const { container, inventory } = fakeContainer({
      proposals: [
        fakeProposal({ id: "tciprop_confirmed", confirmed_ebay_store_category_id: "ebcat_already" }),
        fakeProposal({ id: "tciprop_rejected", review_status: "REJECTED" }),
        fakeProposal({ id: "tciprop_eligible" }),
      ],
      evaluationResult: { storeCategoryId: "ebcat_1", reason: "irrelevant", matchedRuleId: "ebrule_1", outcome: "RULE_MATCH" },
    })

    const { recomputedCount, results } = await recomputeProposalCategoriesForSnapshot(container, { snapshotId: "tcisnap_1" })

    expect(recomputedCount).toBe(1)
    expect(results[0].proposalId).toBe("tciprop_eligible")
    expect(inventory.confirmProposalCategory).toHaveBeenCalledTimes(1)
  })

  it("throws when no single connected eBay environment can be resolved and no override is given", async () => {
    const { container } = fakeContainer({ connections: [], evaluationResult: { storeCategoryId: null, reason: "x", matchedRuleId: null, outcome: "NO_MATCH" } })

    await expect(recomputeProposalCategoriesForSnapshot(container, { snapshotId: "tcisnap_1" }))
      .rejects.toMatchObject({ message: expect.stringMatching(/No single CONNECTED eBay environment/) })
  })

  it("uses an explicit environment override instead of auto-detecting one", async () => {
    const { container, ebayIntegration } = fakeContainer({
      connections: [],
      evaluationResult: { storeCategoryId: "ebcat_1", reason: "irrelevant", matchedRuleId: null, outcome: "FALLBACK" },
    })

    await recomputeProposalCategoriesForSnapshot(container, { snapshotId: "tcisnap_1", environment: "PRODUCTION" })

    expect(ebayIntegration.evaluateCategoryAssignment).toHaveBeenCalledWith("PRODUCTION", expect.anything())
  })
})
