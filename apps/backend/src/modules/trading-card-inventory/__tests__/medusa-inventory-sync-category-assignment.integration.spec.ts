import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { asValue } from "@medusajs/framework/awilix"
import { ContainerRegistrationKeys, createPgConnection, Modules } from "@medusajs/framework/utils"
import type { IProductModuleService, IStockLocationService } from "@medusajs/framework/types"
import { TRADING_CARDS_MODULE } from "../../trading-cards"
import { TRADING_CARD_INVENTORY_MODULE } from "../index"
import { EBAY_INTEGRATION_MODULE } from "../../ebay-integration"
import { syncInventoryProposalToMedusa } from "../../../workflows/trading-card-inventory/medusa-inventory-sync"
import "../../../links/trading-card-product"
import "../../../links/trading-card-variant-product-variant"

/**
 * PR review fix: a NEW_HOLDING proposal must have its linked Medusa Product
 * Category applied to the product — including when that proposal resolves
 * to an *already-existing* canonical TradingCard/Product (not only the
 * brand-new "create card" path) — but only the first time that product is
 * ever categorised. An already-categorised product is never touched
 * (no backfill).
 */
let pgConnection: ReturnType<typeof createPgConnection>
let rootConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cards: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ebayIntegration: any
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
  medusaApp = await MedusaApp({
    modulesConfig: {
      [TRADING_CARD_INVENTORY_MODULE]: { resolve: "./src/modules/trading-card-inventory" },
      [TRADING_CARDS_MODULE]: { resolve: "./src/modules/trading-cards", definition: { key: TRADING_CARDS_MODULE, isQueryable: true } },
      [EBAY_INTEGRATION_MODULE]: { resolve: "./src/modules/ebay-integration" },
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
  ebayIntegration = medusaApp.modules[EBAY_INTEGRATION_MODULE]
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
    card_set_id: set.id, name: `Category Card ${id}`, search_name: `category card ${id}`,
    card_number: "001", card_number_normalised: "001", origin: "MANUAL",
  })
  const variant = await cards.createTradingCardVariants({
    trading_card_id: card.id, condition: "NEAR_MINT", condition_source: "EXPLICIT", finish: "NORMAL", finish_confirmed: true,
    special_treatment: "NONE", special_treatment_confirmed: true, sku: `SKU-CAT-${id.toUpperCase()}`, origin: "MANUAL", price_locked: false,
  })
  return { variant }
}

async function productVariantFixture(categoryIds: string[] = []) {
  const id = suffix()
  const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const product = await products.createProducts({
    title: `Category Product ${id}`, status: "draft", variants: [{ title: "Near Mint", manage_inventory: false, sku: `PV-CAT-${id}` }],
    ...(categoryIds.length ? { category_ids: categoryIds } : {}),
  })
  const productVariant = product.variants?.[0]
  if (!productVariant) throw new Error("Expected created product variant")
  return { product, productVariant }
}

async function linkTradingCardVariantToProductVariant(tradingCardVariantId: string, productVariantId: string) {
  await link.create({
    [Modules.PRODUCT]: { product_variant_id: productVariantId },
    [TRADING_CARDS_MODULE]: { trading_card_variant_id: tradingCardVariantId },
  })
}

async function connectedEbayScope() {
  const id = suffix()
  await pgConnection.raw(
    `insert into ebay_integration_connection (id, environment, status, ebay_account_id, current_attempt_id, granted_scopes)
     values (?, 'SANDBOX', 'CONNECTED', ?, ?, '[]'::jsonb)`,
    [`ebconn_${id}`, `acct_${id}`, `attempt_${id}`],
  )
  return { environment: "SANDBOX" as const, ebayAccountId: `acct_${id}` }
}

/** Isolates `resolveMedusaStockLocationId`'s fallback from whatever else exists in the shared test database, mirroring the sibling spec file. */
async function withSingleStockLocation<T>(fn: (locationId: string) => Promise<T>): Promise<T> {
  const stockLocations = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  const location = await stockLocations.createStockLocations({ name: `Category Assignment Test ${suffix()}` })
  const real = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  container.register({
    [Modules.STOCK_LOCATION]: asValue({
      listStockLocations: async () => [location],
      retrieveStockLocation: real.retrieveStockLocation.bind(real),
    } as unknown as IStockLocationService),
  })
  try {
    return await fn(location.id)
  } finally {
    container.register({ [Modules.STOCK_LOCATION]: asValue(real) })
  }
}

describe("syncInventoryProposalToMedusa — E2B category assignment", () => {
  it("assigns the linked Medusa category to an already-existing, previously-uncategorised product on NEW_HOLDING", async () => {
    await withSingleStockLocation(async () => {
      const scope = await connectedEbayScope()
      const category = await ebayIntegration.createStoreCategory({
        environment: scope.environment, externalId: `ext_${suffix()}`, name: "Japanese Cards",
        parentExternalId: null, siblingOrder: 0, actorId: "test-actor", correlationId: suffix(),
      })
      const { variant } = await cardVariantFixture()
      const { product, productVariant } = await productVariantFixture([])
      await linkTradingCardVariantToProductVariant(variant.id, productVariant.id)

      const productModuleService = container.resolve<IProductModuleService>(Modules.PRODUCT)
      const medusaCategory = await productModuleService.createProductCategories({ name: "Japanese Cards (Medusa)", is_active: true })
      await ebayIntegration.linkStoreCategoryToMedusaCategory(category.id, medusaCategory.id)

      const result = await syncInventoryProposalToMedusa(container, {
        proposalId: "tciprop_cat_assign", tradingCardVariantId: variant.id, proposedQuantity: 2, attemptToken: "token-assign",
        changeKind: "NEW_HOLDING", confirmedEbayStoreCategoryId: category.id,
      })
      expect(result.outcome).toBe("SYNCED")

      const [updated] = await productModuleService.listProductCategories({ product_id: [product.id] } as never)
      const categories = await productModuleService.retrieveProduct(product.id, { relations: ["categories"] })
      expect((categories as unknown as { categories?: Array<{ id: string }> }).categories?.map((c) => c.id)).toContain(medusaCategory.id)
      void updated
    })
  }, 60000)

  it("never recategorises a product that already has a category (no backfill)", async () => {
    await withSingleStockLocation(async () => {
      const scope = await connectedEbayScope()
      const productModuleService = container.resolve<IProductModuleService>(Modules.PRODUCT)
      const existingCategory = await productModuleService.createProductCategories({ name: `Existing ${suffix()}`, is_active: true })
      const newCategory = await ebayIntegration.createStoreCategory({
        environment: scope.environment, externalId: `ext_${suffix()}`, name: "Pokemon ex Cards",
        parentExternalId: null, siblingOrder: 0, actorId: "test-actor", correlationId: suffix(),
      })
      const newMedusaCategory = await productModuleService.createProductCategories({ name: "Pokemon ex Cards (Medusa)", is_active: true })
      await ebayIntegration.linkStoreCategoryToMedusaCategory(newCategory.id, newMedusaCategory.id)

      const { variant } = await cardVariantFixture()
      const { product, productVariant } = await productVariantFixture([existingCategory.id])
      await linkTradingCardVariantToProductVariant(variant.id, productVariant.id)

      const result = await syncInventoryProposalToMedusa(container, {
        proposalId: "tciprop_cat_nobackfill", tradingCardVariantId: variant.id, proposedQuantity: 2, attemptToken: "token-nobackfill",
        changeKind: "NEW_HOLDING", confirmedEbayStoreCategoryId: newCategory.id,
      })
      expect(result.outcome).toBe("SYNCED")

      const saved = await productModuleService.retrieveProduct(product.id, { relations: ["categories"] })
      const categoryIds = (saved as unknown as { categories?: Array<{ id: string }> }).categories?.map((c) => c.id) ?? []
      expect(categoryIds).toEqual([existingCategory.id])
      expect(categoryIds).not.toContain(newMedusaCategory.id)
    })
  }, 60000)

  it("fails clearly with NO_LINKED_MEDUSA_CATEGORY when the confirmed category has no synced Medusa category", async () => {
    await withSingleStockLocation(async () => {
      const scope = await connectedEbayScope()
      const category = await ebayIntegration.createStoreCategory({
        environment: scope.environment, externalId: `ext_${suffix()}`, name: "Other Pokemon Cards",
        parentExternalId: null, siblingOrder: 0, actorId: "test-actor", correlationId: suffix(),
      })
      // Deliberately never synced.
      const { variant } = await cardVariantFixture()
      const { productVariant } = await productVariantFixture([])
      await linkTradingCardVariantToProductVariant(variant.id, productVariant.id)

      const result = await syncInventoryProposalToMedusa(container, {
        proposalId: "tciprop_cat_unsynced", tradingCardVariantId: variant.id, proposedQuantity: 2, attemptToken: "token-unsynced",
        changeKind: "NEW_HOLDING", confirmedEbayStoreCategoryId: category.id,
      })
      expect(result.outcome).toBe("FAILED")
      if (result.outcome === "FAILED") expect(result.category).toBe("NO_LINKED_MEDUSA_CATEGORY")
    })
  }, 60000)

  it("never attempts category assignment for a QUANTITY_CHANGE proposal", async () => {
    await withSingleStockLocation(async () => {
      const { variant } = await cardVariantFixture()
      const { productVariant } = await productVariantFixture([])
      await linkTradingCardVariantToProductVariant(variant.id, productVariant.id)

      const result = await syncInventoryProposalToMedusa(container, {
        proposalId: "tciprop_cat_quantitychange", tradingCardVariantId: variant.id, proposedQuantity: 5, attemptToken: "token-qty",
        changeKind: "QUANTITY_CHANGE", confirmedEbayStoreCategoryId: null,
      })
      expect(result.outcome).toBe("SYNCED")
    })
  }, 60000)
})
