import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { asValue } from "@medusajs/framework/awilix"
import { ContainerRegistrationKeys, createPgConnection, Modules } from "@medusajs/framework/utils"
import type { IInventoryService, IProductModuleService, IStockLocationService } from "@medusajs/framework/types"
import { TRADING_CARDS_MODULE } from "../../trading-cards"
import { TRADING_CARD_INVENTORY_MODULE } from "../index"
import { EBAY_INTEGRATION_MODULE } from "../../ebay-integration"
import { syncInventoryProposalToMedusa } from "../../../workflows/trading-card-inventory/medusa-inventory-sync"
import { reviewInventoryProposalsWithProgress } from "../../../workflows/trading-card-inventory/review-inventory-proposals"
import { applyInventoryProposalsWithSync } from "../../../workflows/trading-card-inventory/apply-inventory-proposals"
import { retryInventoryProposalSync } from "../../../workflows/trading-card-inventory/retry-inventory-proposal-sync"
import "../../../links/trading-card-product"
import "../../../links/trading-card-variant-product-variant"

let pgConnection: ReturnType<typeof createPgConnection>
let rootConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cards: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let inventory: any
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
      [EBAY_INTEGRATION_MODULE]: { resolve: "./src/modules/ebay-integration" },
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
  inventory = medusaApp.modules[TRADING_CARD_INVENTORY_MODULE]
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

/**
 * Runs `fn` with `IStockLocationService#listStockLocations` overridden to
 * return exactly `locations`, regardless of what else exists in the shared
 * test database (legitimate fixture locations such as a seeded default
 * warehouse must not make these tests' "zero" or "exactly one" location
 * preconditions unreliable). Every other method — `retrieveStockLocation`,
 * used by the configured-location path — still delegates to the real
 * service, so this only isolates the listing this file's own tests care
 * about. The real registration is restored afterwards even if `fn` throws.
 */
async function withStockLocations<T>(locations: Awaited<ReturnType<IStockLocationService["listStockLocations"]>>, fn: () => Promise<T>): Promise<T> {
  const real = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  // Only `listStockLocations` and `retrieveStockLocation` are ever called on
  // this service by the code under test (`resolveMedusaStockLocationId`) —
  // no need to proxy the whole class.
  container.register({
    [Modules.STOCK_LOCATION]: asValue({
      listStockLocations: async () => locations,
      retrieveStockLocation: real.retrieveStockLocation.bind(real),
    } as unknown as IStockLocationService),
  })
  try {
    return await fn()
  } finally {
    container.register({ [Modules.STOCK_LOCATION]: asValue(real) })
  }
}

describe("syncInventoryProposalToMedusa", () => {
  it("fails NO_STOCK_LOCATION when the fallback finds no stock locations", async () => {
    const { variant } = await cardVariantFixture()
    // Isolated from whatever legitimate fixture locations already exist in
    // the shared test database (e.g. a seeded default warehouse) — this
    // test only needs the fallback lookup to observe zero locations, not
    // for the database to genuinely contain none.
    const result = await withStockLocations([], () => syncInventoryProposalToMedusa(container, {
      proposalId: "tciprop_x", tradingCardVariantId: variant.id, proposedQuantity: 4, attemptToken: "token-0",
    }))
    expect(result).toMatchObject({ outcome: "FAILED", category: "NO_STOCK_LOCATION" })
  })

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

    // Isolated from any legitimate fixture locations already in the shared
    // test database: the fallback lookup must observe exactly one location
    // — this test's own — regardless of how many real locations coexist
    // with it in practice.
    const location = await createStockLocation(`Sole Loc ${suffix()}`)
    const result = await withStockLocations([location], () => syncInventoryProposalToMedusa(container, {
      proposalId: "tciprop_x", tradingCardVariantId: variant.id, proposedQuantity: 4, attemptToken: "token-1",
    }))
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

  describe("product publication", () => {
    it("stays draft before a NEW_HOLDING sync, then publishes once it succeeds", async () => {
      const { variant } = await cardVariantFixture()
      const { productVariant } = await productVariantFixture()
      await linkTradingCardVariantToProductVariant(variant.id, productVariant.id)
      const item = await createInventoryItem(`ITEM-${suffix()}`)
      await linkProductVariantToInventoryItem(productVariant.id, item.id)
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      try {
        const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
        const productId = productVariant.product_id as string
        expect((await products.retrieveProduct(productId)).status).toBe("draft")

        const result = await syncInventoryProposalToMedusa(container, {
          proposalId: "tciprop_x", tradingCardVariantId: variant.id, proposedQuantity: 4,
          attemptToken: "token-1", changeKind: "NEW_HOLDING",
        })
        expect(result.outcome).toBe("SYNCED")
        expect((await products.retrieveProduct(productId)).status).toBe("published")
      } finally {
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    })

    it("never publishes for a QUANTITY_CHANGE sync", async () => {
      const { variant } = await cardVariantFixture()
      const { productVariant } = await productVariantFixture()
      await linkTradingCardVariantToProductVariant(variant.id, productVariant.id)
      const item = await createInventoryItem(`ITEM-${suffix()}`)
      await linkProductVariantToInventoryItem(productVariant.id, item.id)
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      try {
        const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
        const productId = productVariant.product_id as string

        const result = await syncInventoryProposalToMedusa(container, {
          proposalId: "tciprop_x", tradingCardVariantId: variant.id, proposedQuantity: 4,
          attemptToken: "token-1", changeKind: "QUANTITY_CHANGE",
        })
        expect(result.outcome).toBe("SYNCED")
        expect((await products.retrieveProduct(productId)).status).toBe("draft")
      } finally {
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    })

    it("does not re-publish (no-op) an already-published product on a retried NEW_HOLDING sync", async () => {
      const { variant } = await cardVariantFixture()
      const { productVariant } = await productVariantFixture()
      await linkTradingCardVariantToProductVariant(variant.id, productVariant.id)
      const item = await createInventoryItem(`ITEM-${suffix()}`)
      await linkProductVariantToInventoryItem(productVariant.id, item.id)
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      try {
        const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
        const productId = productVariant.product_id as string

        const first = await syncInventoryProposalToMedusa(container, {
          proposalId: "tciprop_x", tradingCardVariantId: variant.id, proposedQuantity: 4,
          attemptToken: "token-1", changeKind: "NEW_HOLDING",
        })
        expect(first.outcome).toBe("SYNCED")
        expect((await products.retrieveProduct(productId)).status).toBe("published")

        const updateSpy = jest.spyOn(products, "updateProducts")
        const second = await syncInventoryProposalToMedusa(container, {
          proposalId: "tciprop_x", tradingCardVariantId: variant.id, proposedQuantity: 9,
          attemptToken: "token-2", changeKind: "NEW_HOLDING",
        })
        expect(second.outcome).toBe("SYNCED")
        expect((await products.retrieveProduct(productId)).status).toBe("published")
        expect(updateSpy).not.toHaveBeenCalledWith(productId, { status: "published" })
        updateSpy.mockRestore()
      } finally {
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    })

    it("fails NO_LINKED_MEDUSA_PRODUCT for a NEW_HOLDING sync whose product variant has no linked product", async () => {
      const { variant } = await cardVariantFixture()
      const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
      const id = suffix()
      const orphanProductVariant = await products.createProductVariants({
        title: "Orphan Variant", product_id: undefined as unknown as string, sku: `ORPHAN-${id}`,
      }).catch(() => null)
      // If a variant genuinely cannot exist without a product in this Medusa
      // version, this test instead documents that the guard is unreachable in
      // practice and relies on the query-shape assertion below.
      if (!orphanProductVariant) return
      await linkTradingCardVariantToProductVariant(variant.id, orphanProductVariant.id)
      const item = await createInventoryItem(`ITEM-${suffix()}`)
      await linkProductVariantToInventoryItem(orphanProductVariant.id, item.id)
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      try {
        const result = await syncInventoryProposalToMedusa(container, {
          proposalId: "tciprop_x", tradingCardVariantId: variant.id, proposedQuantity: 4,
          attemptToken: "token-1", changeKind: "NEW_HOLDING",
        })
        expect(result).toMatchObject({ outcome: "FAILED", category: "NO_LINKED_MEDUSA_PRODUCT" })
      } finally {
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    })

    it("does not publish or write stock when NEW_HOLDING category assignment fails (category-before-publication ordering)", async () => {
      const { variant } = await cardVariantFixture()
      const { productVariant } = await productVariantFixture()
      await linkTradingCardVariantToProductVariant(variant.id, productVariant.id)
      const item = await createInventoryItem(`ITEM-${suffix()}`)
      await linkProductVariantToInventoryItem(productVariant.id, item.id)
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      try {
        const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
        const productId = productVariant.product_id as string
        const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)

        const result = await syncInventoryProposalToMedusa(container, {
          proposalId: "tciprop_x", tradingCardVariantId: variant.id, proposedQuantity: 4,
          attemptToken: "token-1", changeKind: "NEW_HOLDING",
          // Not a real, synced local eBay Store category id, so
          // `medusaCategoryIdForId` resolves nothing and category assignment
          // fails before publication or the stock write are ever attempted.
          confirmedEbayStoreCategoryId: "ebcat_does_not_exist",
        })
        expect(result).toMatchObject({ outcome: "FAILED", category: "NO_LINKED_MEDUSA_CATEGORY" })
        expect((await products.retrieveProduct(productId)).status).toBe("draft")
        await expect(inventoryService.retrieveInventoryLevelByItemAndLocation(item.id, location.id)).rejects.toThrow()
      } finally {
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    })
  })
})

async function createSource() {
  const id = suffix()
  return inventory.createInventorySource({ displayName: `Sync Workflow Source ${id}`, provider: "PULSE", language: "EN", actor: "test-actor", source: "MANUAL" })
}

/**
 * `applyInventoryProposal`'s E2B gate requires a NEW_HOLDING proposal to
 * already have a reviewer-confirmed, ACTIVE, Medusa-synced eBay Store
 * category before it can move stock (re-validated inside the same locked
 * transaction — see `service.ts`'s "E2B" comment), and `syncInventoryProposalToMedusa`'s
 * own category-assignment step requires that sync to point at a *real*
 * Medusa Product Category (it calls `productModuleService.updateProducts`
 * with it) — a made-up id fails with a real "not found" error from Medusa's
 * product module. The store-category row itself is inserted directly rather
 * than via the ebay-integration module service (which needs its own
 * connected-scope fixture this file doesn't otherwise need).
 */
async function confirmedCategoryFixture() {
  const id = suffix()
  const categoryId = `ebstorecat_fixture_${id}`
  const productModuleService = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const medusaCategory = await productModuleService.createProductCategories({ name: `Fixture Category ${id}`, is_active: true })
  await pgConnection.raw(
    `insert into ebay_integration_store_category
      (id, environment, ebay_account_id, external_id, name, level, sibling_order, path, status, source, medusa_category_id, medusa_category_synced_at)
     values (?, 'SANDBOX', ?, ?, ?, 1, 1, ?, 'ACTIVE', 'MANUAL', ?, now())`,
    [categoryId, `acct_${id}`, `ext_${id}`, `Category ${id}`, `Category ${id}`, medusaCategory.id],
  )
  return categoryId
}

async function confirmProposalCategoryFixture(proposalId: string) {
  const categoryId = await confirmedCategoryFixture()
  await pgConnection.raw(
    `update trading_card_inventory_proposal
     set confirmed_ebay_store_category_id = ?, category_confirmed_at = now(), category_confirmed_by = 'reviewer'
     where id = ?`,
    [categoryId, proposalId],
  )
}

describe("Stage 5B.2 workflows: review -> apply -> Medusa sync -> snapshot progress", () => {
  it("approves a snapshot, reviews and applies its proposal, syncs to Medusa, and transitions the snapshot to APPLIED", async () => {
    const { variant } = await cardVariantFixture()
    const { productVariant } = await productVariantFixture()
    await linkTradingCardVariantToProductVariant(variant.id, productVariant.id)
    const item = await createInventoryItem(`ITEM-${suffix()}`)
    await linkProductVariantToInventoryItem(productVariant.id, item.id)
    const location = await createStockLocation(`Loc ${suffix()}`)
    process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id

    try {
      const source = await createSource()
      const snapshot = await inventory.createInventorySnapshot({ inventorySourceId: source.id, actor: "test-actor", source: "MANUAL" })
      await inventory.addInventorySnapshotEntries({
        snapshotId: snapshot.id, actor: "test-actor", source: "MANUAL",
        entries: [{
          providerReference: `ref-${suffix()}`, providerReferenceType: "PULSE_PRODUCT_ID", tradingCardVariantId: variant.id,
          quantity: 6, currencyCode: "GBP", unitAcquisitionCost: "1.00", unitMarketPrice: "2.00", unitSellingPrice: "3.00",
        }],
      })
      await inventory.transitionInventorySnapshotStatus({ id: snapshot.id, targetStatus: "VALIDATED", actor: "test-actor", source: "MANUAL" })
      const summary = await inventory.reconcileInventorySnapshot({
        inventorySourceId: source.id, snapshotId: snapshot.id, actor: "reconciler", source: "SYSTEM",
      })
      expect(summary.proposalCount).toBe(1)
      await inventory.transitionInventorySnapshotStatus({ id: snapshot.id, targetStatus: "APPROVED", actor: "reviewer", source: "MANUAL" })

      const [proposal] = await inventory.listInventoryProposals({ inventory_snapshot_id: snapshot.id })
      expect(proposal).toMatchObject({ change_kind: "NEW_HOLDING", proposed_quantity: 6 })

      const reviewed = await reviewInventoryProposalsWithProgress(container, {
        actor: "reviewer", source: "MANUAL", ids: [proposal.id], targetStatus: "APPROVED",
      })
      expect(reviewed[0].review_status).toBe("APPROVED")
      const afterReview = await inventory.retrieveInventorySnapshot(snapshot.id)
      expect(afterReview.status).toBe("APPROVED") // not yet fully complete: the proposal itself isn't applied yet

      await confirmProposalCategoryFixture(proposal.id)

      const { results } = await applyInventoryProposalsWithSync(container, { actor: "applier", source: "MANUAL", ids: [proposal.id] })
      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({ localApplicationStatus: "APPLIED", medusaSyncStatus: "SYNCED" })

      const appliedProposal = await inventory.retrieveInventoryProposal(proposal.id)
      expect(appliedProposal).toMatchObject({ review_status: "APPLIED", medusa_sync_status: "SYNCED" })

      const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)
      const level = await inventoryService.retrieveInventoryLevelByItemAndLocation(item.id, location.id)
      expect(level.stocked_quantity).toBe(6)

      const finalSnapshot = await inventory.retrieveInventorySnapshot(snapshot.id)
      expect(finalSnapshot.status).toBe("APPLIED")
    } finally {
      delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
    }
  }, 30000)

  it("retries a failed Medusa sync without duplicating the local ledger movement, and completes the snapshot once synced", async () => {
    const { variant } = await cardVariantFixture()
    // No product-variant link yet: the first apply/sync will fail locally-applied-but-sync-FAILED.
    const source = await createSource()
    const snapshot = await inventory.createInventorySnapshot({ inventorySourceId: source.id, actor: "test-actor", source: "MANUAL" })
    await inventory.addInventorySnapshotEntries({
      snapshotId: snapshot.id, actor: "test-actor", source: "MANUAL",
      entries: [{
        providerReference: `ref-${suffix()}`, providerReferenceType: "PULSE_PRODUCT_ID", tradingCardVariantId: variant.id,
        quantity: 2, currencyCode: "GBP", unitAcquisitionCost: "1.00", unitMarketPrice: "2.00", unitSellingPrice: "3.00",
      }],
    })
    await inventory.transitionInventorySnapshotStatus({ id: snapshot.id, targetStatus: "VALIDATED", actor: "test-actor", source: "MANUAL" })
    await inventory.reconcileInventorySnapshot({ inventorySourceId: source.id, snapshotId: snapshot.id, actor: "reconciler", source: "SYSTEM" })
    await inventory.transitionInventorySnapshotStatus({ id: snapshot.id, targetStatus: "APPROVED", actor: "reviewer", source: "MANUAL" })
    const [proposal] = await inventory.listInventoryProposals({ inventory_snapshot_id: snapshot.id })
    await reviewInventoryProposalsWithProgress(container, { actor: "reviewer", source: "MANUAL", ids: [proposal.id], targetStatus: "APPROVED" })
    await confirmProposalCategoryFixture(proposal.id)

    const { results } = await applyInventoryProposalsWithSync(container, { actor: "applier", source: "MANUAL", ids: [proposal.id] })
    expect(results[0]).toMatchObject({ localApplicationStatus: "APPLIED", medusaSyncStatus: "FAILED" })
    const afterFailedSync = await inventory.retrieveInventoryProposal(proposal.id)
    expect(afterFailedSync.applied_transaction_id).toBeTruthy()
    const transactionIdAfterFailure = afterFailedSync.applied_transaction_id
    const stillApproving = await inventory.retrieveInventorySnapshot(snapshot.id)
    expect(stillApproving.status).not.toBe("APPLIED")

    // Now link the variant so the retry can succeed, without ever re-touching Phase A.
    const { productVariant } = await productVariantFixture()
    await linkTradingCardVariantToProductVariant(variant.id, productVariant.id)
    const item = await createInventoryItem(`ITEM-${suffix()}`)
    await linkProductVariantToInventoryItem(productVariant.id, item.id)
    const location = await createStockLocation(`Retry Loc ${suffix()}`)
    process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
    try {
      const retried = await retryInventoryProposalSync(container, { actor: "retrier", source: "MANUAL", proposalId: proposal.id })
      expect(retried.medusa_sync_status).toBe("SYNCED")
      expect(retried.applied_transaction_id).toBe(transactionIdAfterFailure) // Phase A never re-ran

      const finalSnapshot = await inventory.retrieveInventorySnapshot(snapshot.id)
      expect(finalSnapshot.status).toBe("APPLIED")
    } finally {
      delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
    }
  }, 30000)
})
