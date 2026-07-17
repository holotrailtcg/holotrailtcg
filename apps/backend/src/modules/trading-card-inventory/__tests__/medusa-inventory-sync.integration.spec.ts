import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { asValue } from "@medusajs/framework/awilix"
import { ContainerRegistrationKeys, createPgConnection, Modules } from "@medusajs/framework/utils"
import type { IInventoryService, IProductModuleService, IStockLocationService } from "@medusajs/framework/types"
import { TRADING_CARDS_MODULE } from "../../trading-cards"
import { TRADING_CARD_INVENTORY_MODULE } from "../index"
import { syncInventoryProposalToMedusa } from "../../../workflows/trading-card-inventory/medusa-inventory-sync"
import "../../../links/trading-card-product"
import "../../../links/trading-card-variant-product-variant"

let pgConnection: ReturnType<typeof createPgConnection>
let rootConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cards: any
let container: ReturnType<typeof buildContainer>
let link: NonNullable<Awaited<ReturnType<typeof MedusaApp>>["link"]>

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

function buildContainer() {
  if (!medusaApp.sharedContainer) throw new Error("Expected Medusa shared container")
  return medusaApp.sharedContainer
}

beforeAll(async () => {
  rootConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  pgConnection = (await rootConnection.transaction()) as never
  // Roll back the suite as one unit so it cannot pollute the shared test database.
  medusaApp = await MedusaApp({
    modulesConfig: {
      [TRADING_CARD_INVENTORY_MODULE]: { resolve: "./src/modules/trading-card-inventory" },
      [TRADING_CARDS_MODULE]: { resolve: "./src/modules/trading-cards", definition: { key: TRADING_CARDS_MODULE, isQueryable: true } },
      [Modules.PRODUCT]: { resolve: "@medusajs/medusa/product" },
      [Modules.INVENTORY]: { resolve: "@medusajs/medusa/inventory" },
      [Modules.STOCK_LOCATION]: { resolve: "@medusajs/medusa/stock-location" },
    },
    injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection },
    cwd: process.cwd(),
  })
  await medusaApp.onApplicationStart()
  if (!medusaApp.sharedContainer || !medusaApp.link || !medusaApp.query) throw new Error("Expected Medusa link/query container")
  medusaApp.sharedContainer.register("link", asValue(medusaApp.link))
  medusaApp.sharedContainer.register(ContainerRegistrationKeys.QUERY, asValue(medusaApp.query))
  link = medusaApp.link
  cards = medusaApp.modules[TRADING_CARDS_MODULE]
  container = buildContainer()
}, 60000)

afterAll(async () => {
  await medusaApp?.onApplicationPrepareShutdown()
  await medusaApp?.onApplicationShutdown()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (pgConnection as any)?.rollback()
  await rootConnection?.destroy()
})

async function cardVariantFixture() {
  const id = suffix()
  const set = await cards.createCardSets({ game: "POKEMON", language: "EN", display_name: `Set ${id}`, provider_set_code: `set_${id}` })
  const card = await cards.createTradingCards({
    card_set_id: set.id, name: `Sync Card ${id}`, search_name: `sync card ${id}`,
    card_number: "001", card_number_normalised: "001", origin: "MANUAL",
  })
  const variant = await cards.createTradingCardVariants({
    trading_card_id: card.id, condition: "NEAR_MINT", condition_source: "EXPLICIT", finish: "NORMAL", finish_confirmed: true,
    special_treatment: "NONE", special_treatment_confirmed: true, sku: `SKU-${id.toUpperCase()}`, origin: "MANUAL", price_locked: false,
  })
  return { variant }
}

async function productVariantFixture() {
  const id = suffix()
  const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const product = await products.createProducts({
    title: `Sync Product ${id}`, status: "draft", variants: [{ title: "Near Mint", manage_inventory: false, sku: `PV-${id}` }],
  })
  const productVariant = product.variants?.[0]
  if (!productVariant) throw new Error("Expected created product variant")
  return { productVariant }
}

async function linkTradingCardVariantToProductVariant(tradingCardVariantId: string, productVariantId: string) {
  await link.create({
    [Modules.PRODUCT]: { product_variant_id: productVariantId },
    [TRADING_CARDS_MODULE]: { trading_card_variant_id: tradingCardVariantId },
  })
}

async function linkProductVariantToInventoryItem(productVariantId: string, inventoryItemId: string) {
  await link.create({
    [Modules.PRODUCT]: { variant_id: productVariantId },
    [Modules.INVENTORY]: { inventory_item_id: inventoryItemId },
  })
}

async function createInventoryItem(sku: string) {
  const inventory = container.resolve<IInventoryService>(Modules.INVENTORY)
  return inventory.createInventoryItems({ sku })
}

async function createStockLocation(name: string) {
  const stockLocations = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  return stockLocations.createStockLocations({ name })
}

describe("syncInventoryProposalToMedusa", () => {
  it(
    "spike: resolves inventory_items via a single query.graph hop from trading_card_variant → product_variant → inventory_items",
    async () => {
      const { variant } = await cardVariantFixture()
      const { productVariant } = await productVariantFixture()
      await linkTradingCardVariantToProductVariant(variant.id, productVariant.id)
      const item = await createInventoryItem(`ITEM-${suffix()}`)
      await linkProductVariantToInventoryItem(productVariant.id, item.id)

      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "trading_card_variant",
        fields: ["id", "product_variant.id", "product_variant.inventory_items.inventory_item_id"],
        filters: { id: variant.id },
      })
      const linked = data[0]?.product_variant as { id?: string; inventory_items?: Array<{ inventory_item_id?: string }> } | null
      expect(linked?.id).toBe(productVariant.id)
      // `inventory_items` resolves link-pivot rows (`pvitem_...`), not InventoryItemDTOs —
      // the real inventory item id is the pivot's `inventory_item_id`, not its own `id`.
      expect(linked?.inventory_items?.[0]?.inventory_item_id).toBe(item.id)
    },
    30000
  )

  it("auto-picks the sole stock location when none is configured", async () => {
    const { variant } = await cardVariantFixture()
    const { productVariant } = await productVariantFixture()
    await linkTradingCardVariantToProductVariant(variant.id, productVariant.id)
    const item = await createInventoryItem(`ITEM-${suffix()}`)
    await linkProductVariantToInventoryItem(productVariant.id, item.id)

    const stockLocations = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
    const preExisting = await stockLocations.listStockLocations({})
    expect(preExisting).toHaveLength(0) // guarantees this test genuinely exercises the auto-pick-if-exactly-one path

    const location = await createStockLocation(`Sole Loc ${suffix()}`)
    const result = await syncInventoryProposalToMedusa(container, {
      proposalId: "tciprop_x", tradingCardVariantId: variant.id, proposedQuantity: 4, attemptToken: "token-1",
    })
    expect(result).toMatchObject({ outcome: "SYNCED", medusaStockLocationId: location.id })
  })

  it("fails AMBIGUOUS_STOCK_LOCATION when more than one stock location exists and none is configured", async () => {
    const { variant } = await cardVariantFixture()
    const { productVariant } = await productVariantFixture()
    await linkTradingCardVariantToProductVariant(variant.id, productVariant.id)
    const item = await createInventoryItem(`ITEM-${suffix()}`)
    await linkProductVariantToInventoryItem(productVariant.id, item.id)

    await createStockLocation(`Extra Loc ${suffix()}`)
    await createStockLocation(`Extra Loc 2 ${suffix()}`)
    const result = await syncInventoryProposalToMedusa(container, {
      proposalId: "tciprop_x", tradingCardVariantId: variant.id, proposedQuantity: 4, attemptToken: "token-1",
    })
    expect(result).toMatchObject({ outcome: "FAILED", category: "AMBIGUOUS_STOCK_LOCATION" })
  })

  it("fails NO_PRODUCT_VARIANT_LINK when the trading card variant has no linked product variant", async () => {
    const { variant } = await cardVariantFixture()
    const location = await createStockLocation(`Loc ${suffix()}`)
    process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
    try {
      const result = await syncInventoryProposalToMedusa(container, {
        proposalId: "tciprop_x", tradingCardVariantId: variant.id, proposedQuantity: 5, attemptToken: "token-1",
      })
      expect(result).toMatchObject({ outcome: "FAILED", category: "NO_PRODUCT_VARIANT_LINK" })
    } finally {
      delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
    }
  })

  it("fails NO_INVENTORY_ITEM_LINK when the product variant has no linked inventory item", async () => {
    const { variant } = await cardVariantFixture()
    const { productVariant } = await productVariantFixture()
    await linkTradingCardVariantToProductVariant(variant.id, productVariant.id)
    const location = await createStockLocation(`Loc ${suffix()}`)
    process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
    try {
      const result = await syncInventoryProposalToMedusa(container, {
        proposalId: "tciprop_x", tradingCardVariantId: variant.id, proposedQuantity: 5, attemptToken: "token-1",
      })
      expect(result).toMatchObject({ outcome: "FAILED", category: "NO_INVENTORY_ITEM_LINK" })
    } finally {
      delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
    }
  })

  it("fails INVALID_CONFIGURED_STOCK_LOCATION for an unresolvable configured location id", async () => {
    const { variant } = await cardVariantFixture()
    process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = "sloc_does_not_exist"
    try {
      const result = await syncInventoryProposalToMedusa(container, {
        proposalId: "tciprop_x", tradingCardVariantId: variant.id, proposedQuantity: 5, attemptToken: "token-1",
      })
      expect(result).toMatchObject({ outcome: "FAILED", category: "INVALID_CONFIGURED_STOCK_LOCATION" })
    } finally {
      delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
    }
  })

  it("creates a new inventory level (absolute quantity) on first sync, then updates it (never a delta) on a second sync", async () => {
    const { variant } = await cardVariantFixture()
    const { productVariant } = await productVariantFixture()
    await linkTradingCardVariantToProductVariant(variant.id, productVariant.id)
    const item = await createInventoryItem(`ITEM-${suffix()}`)
    await linkProductVariantToInventoryItem(productVariant.id, item.id)
    const location = await createStockLocation(`Loc ${suffix()}`)
    process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
    try {
      const first = await syncInventoryProposalToMedusa(container, {
        proposalId: "tciprop_x", tradingCardVariantId: variant.id, proposedQuantity: 7, attemptToken: "token-1",
      })
      expect(first).toMatchObject({ outcome: "SYNCED", medusaInventoryItemId: item.id, medusaStockLocationId: location.id })

      const inventory = container.resolve<IInventoryService>(Modules.INVENTORY)
      const levelAfterFirst = await inventory.retrieveInventoryLevelByItemAndLocation(item.id, location.id)
      expect(levelAfterFirst.stocked_quantity).toBe(7)

      const second = await syncInventoryProposalToMedusa(container, {
        proposalId: "tciprop_x", tradingCardVariantId: variant.id, proposedQuantity: 3, attemptToken: "token-2",
      })
      expect(second.outcome).toBe("SYNCED")
      const levelAfterSecond = await inventory.retrieveInventoryLevelByItemAndLocation(item.id, location.id)
      expect(levelAfterSecond.stocked_quantity).toBe(3)
    } finally {
      delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
    }
  })
})
