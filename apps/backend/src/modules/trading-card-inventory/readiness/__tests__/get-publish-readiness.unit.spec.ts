import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../../../trading-cards"
import { TRADING_CARD_INVENTORY_MODULE } from "../../index"
import { getPublishReadiness, PUBLISH_READINESS_BLOCKER } from "../get-publish-readiness"

interface FakeSetup {
  variant?: Record<string, unknown>
  readyImages?: unknown[]
  linkedVariant?: { product_variant?: { id?: string; product?: { id?: string } } | null }
  holdings?: Array<Record<string, unknown>>
  pendingProposals?: unknown[]
}

function fakeContainer(setup: FakeSetup) {
  const variant = setup.variant ?? {
    id: "tcvar_1",
    trading_card: { rarity: "COMMON", rarity_icon_key: "common" },
  }
  const cards = {
    retrieveTradingCardVariant: jest.fn().mockResolvedValue(variant),
    listCardImages: jest.fn().mockResolvedValue(setup.readyImages ?? [{ id: "tcimg_1" }]),
  }
  const inventory = {
    listInventoryHoldings: jest.fn().mockResolvedValue(setup.holdings ?? [
      { quantity: 3, unit_selling_price: "2.50", inventory_source: { status: "ACTIVE" } },
    ]),
    listInventoryProposals: jest.fn().mockResolvedValue(setup.pendingProposals ?? []),
  }
  const productVariant = "linkedVariant" in setup
    ? setup.linkedVariant?.product_variant ?? null
    : { id: "pvar_1", product: { id: "prod_1" } }
  const query = {
    graph: jest.fn().mockResolvedValue({
      data: [{ id: "tcvar_1", product_variant: productVariant }],
    }),
  }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === TRADING_CARDS_MODULE) return cards
      if (key === TRADING_CARD_INVENTORY_MODULE) return inventory
      if (key === ContainerRegistrationKeys.QUERY) return query
      throw new Error(`Unexpected resolve key: ${key}`)
    }),
  }
  return { container, cards, inventory, query }
}

describe("getPublishReadiness", () => {
  it("is ready when every signal is satisfied", async () => {
    const { container } = fakeContainer({})
    const result = await getPublishReadiness(container as never, "tcvar_1")
    expect(result).toEqual({ tradingCardVariantId: "tcvar_1", ready: true, blockers: [] })
  })

  it("blocks on unresolved TCGdex/rarity data", async () => {
    const { container } = fakeContainer({ variant: { id: "tcvar_1", trading_card: { rarity: null, rarity_icon_key: null } } })
    const result = await getPublishReadiness(container as never, "tcvar_1")
    expect(result.blockers).toContain(PUBLISH_READINESS_BLOCKER.NO_APPROVED_TCGDEX_DATA)
  })

  it("blocks when there is no READY card image", async () => {
    const { container } = fakeContainer({ readyImages: [] })
    const result = await getPublishReadiness(container as never, "tcvar_1")
    expect(result.blockers).toContain(PUBLISH_READINESS_BLOCKER.NO_READY_IMAGE)
  })

  it("blocks when there is no linked Medusa product", async () => {
    const { container } = fakeContainer({ linkedVariant: { product_variant: null } })
    const result = await getPublishReadiness(container as never, "tcvar_1")
    expect(result.blockers).toContain(PUBLISH_READINESS_BLOCKER.NO_LINKED_PRODUCT)
  })

  it("blocks on zero approved quantity when no READY holding on an ACTIVE source exists", async () => {
    const { container } = fakeContainer({ holdings: [] })
    const result = await getPublishReadiness(container as never, "tcvar_1")
    expect(result.blockers).toContain(PUBLISH_READINESS_BLOCKER.ZERO_APPROVED_QUANTITY)
  })

  it("blocks on zero approved quantity when the only holding is on an ARCHIVED source", async () => {
    const { container } = fakeContainer({
      holdings: [{ quantity: 5, unit_selling_price: "2.50", inventory_source: { status: "ARCHIVED" } }],
    })
    const result = await getPublishReadiness(container as never, "tcvar_1")
    expect(result.blockers).toContain(PUBLISH_READINESS_BLOCKER.ZERO_APPROVED_QUANTITY)
  })

  it("blocks on an invalid or missing selling price when quantity is otherwise approved", async () => {
    const { container } = fakeContainer({
      holdings: [{ quantity: 3, unit_selling_price: null, inventory_source: { status: "ACTIVE" } }],
    })
    const result = await getPublishReadiness(container as never, "tcvar_1")
    expect(result.blockers).toContain(PUBLISH_READINESS_BLOCKER.INVALID_OR_MISSING_SELLING_PRICE)
    expect(result.blockers).not.toContain(PUBLISH_READINESS_BLOCKER.ZERO_APPROVED_QUANTITY)
  })

  it("blocks on an unresolved pending proposal", async () => {
    const { container } = fakeContainer({ pendingProposals: [{ id: "tciprop_1" }] })
    const result = await getPublishReadiness(container as never, "tcvar_1")
    expect(result.blockers).toContain(PUBLISH_READINESS_BLOCKER.UNRESOLVED_PENDING_PROPOSAL)
  })

  it("can report multiple simultaneous blockers", async () => {
    const { container } = fakeContainer({
      variant: { id: "tcvar_1", trading_card: { rarity: null, rarity_icon_key: null } },
      readyImages: [],
      holdings: [],
    })
    const result = await getPublishReadiness(container as never, "tcvar_1")
    expect(result.ready).toBe(false)
    expect(result.blockers).toEqual(expect.arrayContaining([
      PUBLISH_READINESS_BLOCKER.NO_APPROVED_TCGDEX_DATA,
      PUBLISH_READINESS_BLOCKER.NO_READY_IMAGE,
      PUBLISH_READINESS_BLOCKER.ZERO_APPROVED_QUANTITY,
    ]))
  })
})
