import { TRADING_CARD_INVENTORY_MODULE } from "../../../modules/trading-card-inventory"
import { publishInventoryProposalsForSnapshot } from "../publish-inventory-proposals"

function fakeProposal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "tciprop_1", review_status: "PENDING", change_kind: "NEW_HOLDING",
    trading_card_variant_id: "tcvar_1", proposed_quantity: 3, confirmed_ebay_store_category_id: "ebcat_1",
    ...overrides,
  }
}

function fakeContainer(options: { proposals?: Partial<Record<string, unknown>>[] } = {}) {
  const inventory = {
    listInventoryProposals: jest.fn(async () => options.proposals ?? [fakeProposal()]),
    reviewInventoryProposals: jest.fn(async (input: { ids: string[] }): Promise<Record<string, unknown>[]> => [
      { id: input.ids[0], review_status: "APPROVED", change_kind: "NEW_HOLDING", trading_card_variant_id: "tcvar_1", proposed_quantity: 3, confirmed_ebay_store_category_id: "ebcat_1" },
    ]),
    applyInventoryProposal: jest.fn(async () => ({ localApplicationStatus: "APPLIED" })),
  }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === TRADING_CARD_INVENTORY_MODULE) return inventory
      throw new Error(`Unexpected resolve key: ${key}`)
    }),
  }
  return { container: container as never, inventory }
}

describe("publishInventoryProposalsForSnapshot", () => {
  it("approves then applies a still-PENDING, resolved proposal", async () => {
    const { container, inventory } = fakeContainer()

    const result = await publishInventoryProposalsForSnapshot(container, { snapshotId: "tcisnap_1", actor: "reviewer-1", source: "MANUAL" })

    expect(inventory.reviewInventoryProposals).toHaveBeenCalledWith({ actor: "reviewer-1", source: "MANUAL", ids: ["tciprop_1"], targetStatus: "APPROVED" })
    expect(inventory.applyInventoryProposal).toHaveBeenCalledWith({ actor: "reviewer-1", source: "MANUAL", id: "tciprop_1" })
    expect(result).toMatchObject({ processedCount: 1, approvedCount: 1, appliedCount: 1, skippedCount: 0, errors: [] })
  })

  it("only applies (no re-approve) a proposal that is already APPROVED", async () => {
    const { container, inventory } = fakeContainer({
      proposals: [fakeProposal({ review_status: "APPROVED" })],
    })

    const result = await publishInventoryProposalsForSnapshot(container, { snapshotId: "tcisnap_1", actor: "reviewer-1", source: "MANUAL" })

    expect(inventory.reviewInventoryProposals).not.toHaveBeenCalled()
    expect(inventory.applyInventoryProposal).toHaveBeenCalledTimes(1)
    expect(result.approvedCount).toBe(0)
    expect(result.appliedCount).toBe(1)
  })

  it("skips (never force-creates) a PENDING proposal with no resolved card variant", async () => {
    const { container, inventory } = fakeContainer({
      proposals: [fakeProposal({ trading_card_variant_id: null })],
    })

    const result = await publishInventoryProposalsForSnapshot(container, { snapshotId: "tcisnap_1", actor: "reviewer-1", source: "MANUAL" })

    expect(inventory.reviewInventoryProposals).not.toHaveBeenCalled()
    expect(inventory.applyInventoryProposal).not.toHaveBeenCalled()
    expect(result).toMatchObject({ processedCount: 0, totalEligibleCount: 0, approvedCount: 0, appliedCount: 0, skippedCount: 0 })
  })

  it("approves a NEW_HOLDING proposal but does not apply it while its eBay category is still unconfirmed", async () => {
    const { container, inventory } = fakeContainer({ proposals: [fakeProposal({ confirmed_ebay_store_category_id: null })] })
    inventory.reviewInventoryProposals.mockResolvedValueOnce([
      { id: "tciprop_1", review_status: "APPROVED", change_kind: "NEW_HOLDING", trading_card_variant_id: "tcvar_1", proposed_quantity: 3, confirmed_ebay_store_category_id: null },
    ])

    const result = await publishInventoryProposalsForSnapshot(container, { snapshotId: "tcisnap_1", actor: "reviewer-1", source: "MANUAL" })

    expect(inventory.applyInventoryProposal).not.toHaveBeenCalled()
    expect(result).toMatchObject({ approvedCount: 1, appliedCount: 0, skippedCount: 1 })
  })

  it("restricts to the given ids for 'publish selected' rather than every proposal on the snapshot", async () => {
    const { container, inventory } = fakeContainer()

    await publishInventoryProposalsForSnapshot(container, { snapshotId: "tcisnap_1", actor: "reviewer-1", source: "MANUAL", ids: ["tciprop_1"] })

    expect(inventory.listInventoryProposals).toHaveBeenCalledWith({ inventory_snapshot_id: "tcisnap_1", id: ["tciprop_1"] })
  })

  it("chunks via limit/afterId and reports remainingCount for resumable publishing", async () => {
    const { container } = fakeContainer({
      proposals: [
        fakeProposal({ id: "tciprop_a" }),
        fakeProposal({ id: "tciprop_b" }),
        fakeProposal({ id: "tciprop_c" }),
      ],
    })

    const firstBatch = await publishInventoryProposalsForSnapshot(container, { snapshotId: "tcisnap_1", actor: "reviewer-1", source: "MANUAL", limit: 2 })
    expect(firstBatch).toMatchObject({ processedCount: 2, totalEligibleCount: 3, remainingCount: 1, nextCursor: "tciprop_b" })

    const secondBatch = await publishInventoryProposalsForSnapshot(container, { snapshotId: "tcisnap_1", actor: "reviewer-1", source: "MANUAL", limit: 2, afterId: firstBatch.nextCursor! })
    expect(secondBatch).toMatchObject({ processedCount: 1, totalEligibleCount: 3, remainingCount: 0 })
  })

  it("does not skip a proposal that stays eligible after the previous batch (regression: offset-based paging over a shrinking eligible set used to lose rows)", async () => {
    // Simulates real behavior: "tciprop_a" gets APPLIED and disappears from
    // the eligible set on the next call, but "tciprop_b" is skipped (e.g.
    // still needs its eBay category) and stays eligible both times. An
    // offset that simply advanced by `processedCount` would skip past
    // "tciprop_b" entirely; the id cursor must not.
    const inventory = {
      listInventoryProposals: jest.fn()
        .mockResolvedValueOnce([
          fakeProposal({ id: "tciprop_a" }),
          fakeProposal({ id: "tciprop_b", confirmed_ebay_store_category_id: null }),
        ])
        .mockResolvedValueOnce([
          fakeProposal({ id: "tciprop_b", confirmed_ebay_store_category_id: null }),
        ]),
      reviewInventoryProposals: jest.fn(async (input: { ids: string[] }): Promise<Record<string, unknown>[]> => [
        { id: input.ids[0], review_status: "APPROVED", change_kind: "NEW_HOLDING", trading_card_variant_id: "tcvar_1", proposed_quantity: 3, confirmed_ebay_store_category_id: input.ids[0] === "tciprop_b" ? null : "ebcat_1" },
      ]),
      applyInventoryProposal: jest.fn(async () => ({ localApplicationStatus: "APPLIED" })),
    }
    const container = { resolve: jest.fn(() => inventory) } as never

    const firstBatch = await publishInventoryProposalsForSnapshot(container, { snapshotId: "tcisnap_1", actor: "reviewer-1", source: "MANUAL", limit: 1 })
    expect(firstBatch).toMatchObject({ processedCount: 1, nextCursor: "tciprop_a" })

    const secondBatch = await publishInventoryProposalsForSnapshot(container, { snapshotId: "tcisnap_1", actor: "reviewer-1", source: "MANUAL", limit: 1, afterId: firstBatch.nextCursor! })
    expect(secondBatch.processedCount).toBe(1)
    expect(secondBatch.skippedCount).toBe(1)
  })

  it("continues past a single proposal's failure and reports it, rather than aborting the whole batch", async () => {
    const { container, inventory } = fakeContainer({
      proposals: [fakeProposal({ id: "tciprop_a" }), fakeProposal({ id: "tciprop_b" })],
    })
    inventory.applyInventoryProposal
      .mockRejectedValueOnce({ message: "boom" })
      .mockResolvedValueOnce({ localApplicationStatus: "APPLIED" })

    const result = await publishInventoryProposalsForSnapshot(container, { snapshotId: "tcisnap_1", actor: "reviewer-1", source: "MANUAL" })

    expect(result.appliedCount).toBe(1)
    expect(result.skippedCount).toBe(1)
    expect(result.errors).toEqual(["tciprop_a: boom"])
  })
})
