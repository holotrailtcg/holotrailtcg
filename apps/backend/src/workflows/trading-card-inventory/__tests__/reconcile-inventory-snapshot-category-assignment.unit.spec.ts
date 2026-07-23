import { TRADING_CARDS_MODULE } from "../../../modules/trading-cards"
import { TRADING_CARD_INVENTORY_MODULE } from "../../../modules/trading-card-inventory"
import { EBAY_INTEGRATION_MODULE } from "../../../modules/ebay-integration"

import { reconcileInventorySnapshotWithPriceLocks } from "../reconcile-inventory-snapshot"

const PROPOSAL_ID = "tciprop_1"

function fakeProposal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PROPOSAL_ID, change_kind: "NEW_HOLDING", provider_reference: "card:sv1|066/196|holo|nm",
    trading_card_variant_id: "tcvar_1",
    ...overrides,
  }
}

function fakeContainer(options: {
  proposals?: Partial<Record<string, unknown>>[]
  connections?: Array<{ status: string; environment: string }>
  evaluationResult: { storeCategoryId: string | null; reason: string; matchedRuleId: string | null; outcome: string }
} ) {
  const inventory = {
    listSnapshotVariantIds: jest.fn(async () => []),
    reconcileInventorySnapshot: jest.fn(async () => ({ proposalCounts: {} })),
    listInventoryProposals: jest.fn(async () => options.proposals ?? [fakeProposal()]),
    retrieveInventorySnapshot: jest.fn(async () => ({ inventory_source_id: "tcisrc_1" })),
    retrieveInventorySource: jest.fn(async () => ({ language: "EN" })),
    listSnapshotEntriesForAdmin: jest.fn(async () => ({ rows: [{ finish_candidate: "HOLO", special_treatment_candidate: "NONE", rarity_candidate: "RARE" }] })),
    setProposedCategoryAssignment: jest.fn(async () => undefined),
    confirmProposalCategory: jest.fn(async () => undefined),
  }
  const cards = {
    listTradingCardVariants: jest.fn(async () => []),
  }
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
  return { container: container as never, inventory, cards, ebayIntegration }
}

describe("reconcileInventorySnapshotWithPriceLocks — E2B category auto-confirm", () => {
  it("auto-confirms a proposal whose category was resolved by a precise rule match", async () => {
    const { container, inventory } = fakeContainer({
      evaluationResult: { storeCategoryId: "ebcat_1", reason: "Matched rule \"Holo singles\"", matchedRuleId: "ebrule_1", outcome: "RULE_MATCH" },
    })

    await reconcileInventorySnapshotWithPriceLocks(container, {
      actor: "reviewer-1", source: "MANUAL", inventorySourceId: "tcisrc_1", snapshotId: "tcisnap_1",
    })

    expect(inventory.setProposedCategoryAssignment).toHaveBeenCalledWith({
      proposalId: PROPOSAL_ID, storeCategoryId: "ebcat_1", reason: "Matched rule \"Holo singles\"", ruleId: "ebrule_1",
    })
    expect(inventory.confirmProposalCategory).toHaveBeenCalledWith({
      proposalId: PROPOSAL_ID, storeCategoryId: "ebcat_1", actor: "system:category-rule-auto-confirm", source: "SYSTEM", requireUnconfirmed: true,
    })
  })

  it("does not auto-confirm a fallback-category outcome — a reviewer must still confirm it", async () => {
    const { container, inventory } = fakeContainer({
      evaluationResult: { storeCategoryId: "ebcat_fallback", reason: "No rule matched — fallback category applied", matchedRuleId: null, outcome: "FALLBACK" },
    })

    await reconcileInventorySnapshotWithPriceLocks(container, {
      actor: "reviewer-1", source: "MANUAL", inventorySourceId: "tcisrc_1", snapshotId: "tcisnap_1",
    })

    expect(inventory.setProposedCategoryAssignment).toHaveBeenCalled()
    expect(inventory.confirmProposalCategory).not.toHaveBeenCalled()
  })

  it("does not auto-confirm when no category could be proposed at all (NO_MATCH)", async () => {
    const { container, inventory } = fakeContainer({
      evaluationResult: { storeCategoryId: null, reason: "No rule matched and no fallback category is configured", matchedRuleId: null, outcome: "NO_MATCH" },
    })

    await reconcileInventorySnapshotWithPriceLocks(container, {
      actor: "reviewer-1", source: "MANUAL", inventorySourceId: "tcisrc_1", snapshotId: "tcisnap_1",
    })

    expect(inventory.confirmProposalCategory).not.toHaveBeenCalled()
  })

  it("never touches category assignment when there is not exactly one connected eBay environment", async () => {
    const { container, inventory } = fakeContainer({
      connections: [],
      evaluationResult: { storeCategoryId: "ebcat_1", reason: "irrelevant", matchedRuleId: "ebrule_1", outcome: "RULE_MATCH" },
    })

    await reconcileInventorySnapshotWithPriceLocks(container, {
      actor: "reviewer-1", source: "MANUAL", inventorySourceId: "tcisrc_1", snapshotId: "tcisnap_1",
    })

    expect(inventory.setProposedCategoryAssignment).not.toHaveBeenCalled()
    expect(inventory.confirmProposalCategory).not.toHaveBeenCalled()
  })
})
