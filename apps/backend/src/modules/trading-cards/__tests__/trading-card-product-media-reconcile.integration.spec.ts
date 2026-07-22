import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { asValue } from "@medusajs/framework/awilix"
import { ContainerRegistrationKeys, createPgConnection, Modules } from "@medusajs/framework/utils"
import type { IProductModuleService } from "@medusajs/framework/types"
import sharp from "sharp"
import { TRADING_CARDS_MODULE } from "../index"
import { Migration20260715120000 } from "../migrations/Migration20260715120000"
import { FakeR2ImageStorageClient } from "../__fixtures__/fake-r2-client"
import { normaliseCardNumberComparisonForm } from "../identity/card-number"
import tradingCardProductMediaReconcileJob from "../../../jobs/trading-card-product-media-reconcile"
import "../../../links/trading-card-product"
import "../../../links/trading-card-variant-product-variant"

// This suite bootstraps its own MedusaApp with both TRADING_CARDS_MODULE and
// the real PRODUCT module — mirroring
// `create-card-from-inventory-row.integration.spec.ts` — because the job
// under test queries `product` through the `trading_card` link and writes
// real product media through `IProductModuleService`. Per the loader-registry
// note in that file, this must run as its own `--runTestsByPath` invocation,
// isolated from every other spec that also boots TRADING_CARDS_MODULE in the
// same Jest worker. It commits for real (no shared rolled-back transaction).

const R2_ENV = {
  R2_IMAGES_ENABLED: "true",
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
  R2_BUCKET_NAME: "test-card-images",
  R2_S3_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
  R2_PUBLIC_BASE_URL: "https://images.example.com",
}

let pgConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cards: any
let container: ReturnType<typeof buildContainer>
const previousEnvironment: Record<string, string | undefined> = {}

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

function buildContainer() {
  if (!medusaApp.sharedContainer) throw new Error("Expected Medusa shared container")
  return medusaApp.sharedContainer
}

beforeAll(async () => {
  for (const [key, value] of Object.entries(R2_ENV)) {
    previousEnvironment[key] = process.env[key]
    process.env[key] = value
  }

  pgConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  medusaApp = await MedusaApp({
    modulesConfig: {
      [TRADING_CARDS_MODULE]: { resolve: "./src/modules/trading-cards", definition: { key: TRADING_CARDS_MODULE, isQueryable: true } },
      [Modules.PRODUCT]: { resolve: "@medusajs/medusa/product" },
    },
    injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection },
    cwd: process.cwd(),
  })
  await medusaApp.onApplicationStart()
  if (!medusaApp.sharedContainer || !medusaApp.link || !medusaApp.query) throw new Error("Expected Medusa link/query container")
  medusaApp.sharedContainer.register("link", asValue(medusaApp.link))
  medusaApp.sharedContainer.register(ContainerRegistrationKeys.QUERY, asValue(medusaApp.query))
  cards = medusaApp.modules[TRADING_CARDS_MODULE]
  container = buildContainer()

  // See the identical comment in trading-cards-module.spec.ts: this
  // migration's up() must be re-applied before any card-image test runs, in
  // case an earlier-run migration spec in the same Jest worker undid its
  // audit check widening. Idempotent.
  const migration = new Migration20260715120000(undefined as never, undefined as never)
  await migration.up()
  for (const query of migration.getQueries()) await pgConnection.raw(String(query))
  migration.reset()
}, 60000)

afterAll(async () => {
  await medusaApp?.onApplicationPrepareShutdown()
  await medusaApp?.onApplicationShutdown()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (pgConnection as any)?.context?.destroy()
  await pgConnection?.destroy()

  for (const key of Object.keys(R2_ENV)) {
    if (previousEnvironment[key] === undefined) delete process.env[key]
    else process.env[key] = previousEnvironment[key]
  }
})

async function buildJpegFixture(width = 6, height = 8, color = { r: 200, g: 40, b: 40 }): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: color },
  }).jpeg().toBuffer()
}

/** A TradingCardVariant + real linked Product/ProductVariant, with no product media yet. */
async function createLinkedCardAndProduct(overrides: { title?: string } = {}) {
  const id = suffix()
  const set = await cards.createCardSets({
    game: "POKEMON", language: "EN", display_name: `Media Reconcile Set ${id}`, provider_set_code: `set_${id}`,
  })
  const cardNumber = "042/100"
  const card = await cards.createTradingCards({
    card_set_id: set.id, name: `Media Reconcile Card ${id}`, search_name: `media reconcile card ${id}`,
    card_number: cardNumber, card_number_normalised: normaliseCardNumberComparisonForm(cardNumber), origin: "MANUAL",
  })
  const variant = await cards.createTradingCardVariants({
    trading_card_id: card.id, condition: "NEAR_MINT", condition_source: "EXPLICIT", finish: "NORMAL", finish_confirmed: true,
    special_treatment: "NONE", special_treatment_confirmed: true, sku: `SKU-MEDIA-${id.toUpperCase()}`, origin: "MANUAL", price_locked: false,
  })

  const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const product = await products.createProducts({
    title: overrides.title ?? `Media Reconcile Product ${id}`, status: "draft",
    variants: [{ title: "Near Mint", manage_inventory: false, sku: `PV-MEDIA-${id}` }],
  })
  const productVariant = product.variants?.[0]
  if (!productVariant) throw new Error("Expected created product variant")

  const link = medusaApp.link
  if (!link) throw new Error("Expected Medusa link container")
  await link.create({ [Modules.PRODUCT]: { product_id: product.id }, [TRADING_CARDS_MODULE]: { trading_card_id: card.id } })
  await link.create({
    [Modules.PRODUCT]: { product_variant_id: productVariant.id }, [TRADING_CARDS_MODULE]: { trading_card_variant_id: variant.id },
  })

  return { set, card, variant, product, productVariant }
}

/**
 * Uploads and confirms one READY card photograph for `variantId`, using the
 * fake in-memory R2 client. `colorSeed` varies the pixel fill so repeated
 * calls for the same variant produce distinct content (and therefore
 * distinct sha256 hashes) rather than being deduplicated as the same image.
 */
async function createReadyImage(variantId: string, colorSeed = 0) {
  const r2Client = new FakeR2ImageStorageClient()
  const { image } = await cards.beginCardImageUpload({
    tradingCardVariantId: variantId, uploadedBy: "admin_test", originalFilename: "card.jpg",
    declaredMimeType: "image/jpeg", declaredByteSize: 1_048_576, actor: "admin_test", source: "MANUAL", r2Client,
  })
  const bytes = await buildJpegFixture(6, 8, { r: 200, g: 40, b: (colorSeed * 37) % 256 })
  r2Client.seedObject(image.staging_object_key, bytes)
  return cards.confirmPendingCardImage({ id: image.id, actor: "admin_test", source: "MANUAL", r2Client })
}

describe("tradingCardProductMediaReconcileJob", () => {
  it("resyncs a trading-card product with a null thumbnail from its READY images", async () => {
    const { variant, product } = await createLinkedCardAndProduct()
    await createReadyImage(variant.id, 1)
    await createReadyImage(variant.id, 2)

    const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
    await products.updateProducts(product.id, { thumbnail: null, images: [] })

    const before = await products.retrieveProduct(product.id, { relations: ["images"] })
    expect(before.thumbnail).toBeNull()
    expect(before.images).toHaveLength(0)

    await tradingCardProductMediaReconcileJob(container)

    const after = await products.retrieveProduct(product.id, { relations: ["images"] })
    expect(after.thumbnail).toBeTruthy()
    expect(after.thumbnail).toContain("https://images.example.com/")
    expect(after.images).toHaveLength(2)
  }, 60000)

  it("leaves a product that already has a thumbnail untouched", async () => {
    const { variant, product } = await createLinkedCardAndProduct()
    await createReadyImage(variant.id)

    const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
    // Give it a thumbnail unrelated to the trading-card image pipeline —
    // if the job only targets `thumbnail: null` rows, this must never change.
    await products.updateProducts(product.id, { thumbnail: "https://images.example.com/manual-thumbnail.jpg", images: [] })

    await tradingCardProductMediaReconcileJob(container)

    const after = await products.retrieveProduct(product.id, { relations: ["images"] })
    expect(after.thumbnail).toBe("https://images.example.com/manual-thumbnail.jpg")
    expect(after.images).toHaveLength(0)
  }, 60000)

  it("skips a product with a null thumbnail and no trading_card link without erroring", async () => {
    const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
    const id = suffix()
    const product = await products.createProducts({
      title: `Unlinked Product ${id}`, status: "draft", thumbnail: null,
      variants: [{ title: "Default", manage_inventory: false, sku: `PV-UNLINKED-${id}` }],
    })

    await expect(tradingCardProductMediaReconcileJob(container)).resolves.toBeUndefined()

    const after = await products.retrieveProduct(product.id)
    expect(after.thumbnail).toBeNull()
  }, 60000)
})
