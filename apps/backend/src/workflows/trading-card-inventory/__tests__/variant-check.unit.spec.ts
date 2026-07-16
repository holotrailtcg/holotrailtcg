import { MedusaError } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../../../modules/trading-cards"
import { TRADING_CARD_INVENTORY_MODULE } from "../../../modules/trading-card-inventory"
import { upsertInventoryHoldingWithVariantCheck } from "../upsert-inventory-holding"
import { createInventoryProposalWithVariantCheck } from "../create-inventory-proposal"
import { appendInventoryTransactionWithVariantCheck } from "../append-inventory-transaction"

function fakeContainer(options: { variantExists: boolean }) {
  const cards = {
    retrieveTradingCardVariant: jest.fn(async (id: string) => {
      if (!options.variantExists) throw new MedusaError(MedusaError.Types.NOT_FOUND, "Trading card variant not found")
      return { id }
    }),
  }
  const inventory = {
    upsertInventoryHolding: jest.fn(async (input) => ({ id: "tcihold_1", ...input })),
    createInventoryProposal: jest.fn(async (input) => ({ id: "tciprop_1", ...input })),
    appendInventoryTransaction: jest.fn(async (input) => ({ id: "tcitxn_1", ...input })),
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

describe("upsertInventoryHoldingWithVariantCheck", () => {
  it("upserts the holding when the trading card variant exists", async () => {
    const { container, inventory } = fakeContainer({ variantExists: true })
    const input = { inventorySourceId: "tcisrc_1", tradingCardVariantId: "tcvar_1", quantity: 3, actor: "user_1", source: "MANUAL" as const }
    await upsertInventoryHoldingWithVariantCheck(container, input)
    expect(inventory.upsertInventoryHolding).toHaveBeenCalledWith(input)
  })

  it("refuses to upsert when the trading card variant does not exist", async () => {
    const { container, inventory } = fakeContainer({ variantExists: false })
    const input = { inventorySourceId: "tcisrc_1", tradingCardVariantId: "tcvar_missing", quantity: 3, actor: "user_1", source: "MANUAL" as const }
    await expect(upsertInventoryHoldingWithVariantCheck(container, input)).rejects.toThrow("not found")
    expect(inventory.upsertInventoryHolding).not.toHaveBeenCalled()
  })
})

describe("createInventoryProposalWithVariantCheck", () => {
  it("validates the variant when one is provided", async () => {
    const { container, cards, inventory } = fakeContainer({ variantExists: true })
    const input = { inventorySourceId: "tcisrc_1", tradingCardVariantId: "tcvar_1", changeKind: "NEW_HOLDING", actor: "user_1", source: "MANUAL" as const }
    await createInventoryProposalWithVariantCheck(container, input)
    expect(cards.retrieveTradingCardVariant).toHaveBeenCalledWith("tcvar_1")
    expect(inventory.createInventoryProposal).toHaveBeenCalledWith(input)
  })

  it("skips variant validation for an unresolved-variant proposal", async () => {
    const { container, cards, inventory } = fakeContainer({ variantExists: false })
    const input = { inventorySourceId: "tcisrc_1", tradingCardVariantId: null, changeKind: "UNRESOLVED_VARIANT", actor: "user_1", source: "MANUAL" as const }
    await createInventoryProposalWithVariantCheck(container, input)
    expect(cards.retrieveTradingCardVariant).not.toHaveBeenCalled()
    expect(inventory.createInventoryProposal).toHaveBeenCalledWith(input)
  })

  it("refuses to create a resolved proposal for a nonexistent variant", async () => {
    const { container } = fakeContainer({ variantExists: false })
    const input = { inventorySourceId: "tcisrc_1", tradingCardVariantId: "tcvar_missing", changeKind: "NEW_HOLDING", actor: "user_1", source: "MANUAL" as const }
    await expect(createInventoryProposalWithVariantCheck(container, input)).rejects.toThrow("not found")
  })
})

describe("appendInventoryTransactionWithVariantCheck", () => {
  it("appends the transaction when the trading card variant exists", async () => {
    const { container, inventory } = fakeContainer({ variantExists: true })
    const input = {
      tradingCardVariantId: "tcvar_1", quantityBefore: 5, quantityAfter: 4, reason: "WEBSITE_SALE",
      actor: "user_1", source: "SYSTEM" as const,
    }
    await appendInventoryTransactionWithVariantCheck(container, input)
    expect(inventory.appendInventoryTransaction).toHaveBeenCalledWith(input)
  })

  it("refuses to append when the trading card variant does not exist", async () => {
    const { container, inventory } = fakeContainer({ variantExists: false })
    const input = {
      tradingCardVariantId: "tcvar_missing", quantityBefore: 5, quantityAfter: 4, reason: "WEBSITE_SALE",
      actor: "user_1", source: "SYSTEM" as const,
    }
    await expect(appendInventoryTransactionWithVariantCheck(container, input)).rejects.toThrow("not found")
    expect(inventory.appendInventoryTransaction).not.toHaveBeenCalled()
  })
})
