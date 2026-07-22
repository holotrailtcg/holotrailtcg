import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection, Modules } from "@medusajs/framework/utils"
import { ensureSeriesCollection, ensureTradingCardProductType, TRADING_CARD_PRODUCT_TYPE_VALUE } from "../../../workflows/trading-cards/ensure-product-taxonomy"

// This suite boots only the core PRODUCT module (no custom TRADING_CARDS_MODULE
// registration), so it is not subject to the custom-module loader-registry
// conflict documented in jest.config.js and needs no `--runTestsByPath`
// isolation entry.

let pgConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
let container: ReturnType<typeof buildContainer>

function buildContainer() {
  if (!medusaApp.sharedContainer) throw new Error("Expected Medusa shared container")
  return medusaApp.sharedContainer
}

beforeAll(async () => {
  pgConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  medusaApp = await MedusaApp({
    modulesConfig: { [Modules.PRODUCT]: { resolve: "@medusajs/medusa/product" } },
    injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection },
    cwd: process.cwd(),
  })
  await medusaApp.onApplicationStart()
  container = buildContainer()
}, 60000)

afterAll(async () => {
  await medusaApp?.onApplicationPrepareShutdown()
  await medusaApp?.onApplicationShutdown()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (pgConnection as any)?.context?.destroy()
  await pgConnection?.destroy()
})

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

describe("ensureTradingCardProductType", () => {
  it("creates the Trading Card product type once and reuses it on repeated calls", async () => {
    const first = await ensureTradingCardProductType(container)
    const second = await ensureTradingCardProductType(container)
    expect(second).toBe(first)

    const products = container.resolve(Modules.PRODUCT)
    const matches = await products.listProductTypes({ value: TRADING_CARD_PRODUCT_TYPE_VALUE })
    expect(matches).toHaveLength(1)
  }, 30000)
})

describe("ensureSeriesCollection", () => {
  it("creates a collection for a series once and reuses it on repeated calls", async () => {
    const seriesName = `Test Series ${suffix()}`
    const first = await ensureSeriesCollection(container, seriesName)
    const second = await ensureSeriesCollection(container, seriesName)
    expect(second).toBe(first)

    const products = container.resolve(Modules.PRODUCT)
    const matches = await products.listProductCollections({ title: seriesName })
    expect(matches).toHaveLength(1)
  }, 30000)

  it("creates separate collections for different series", async () => {
    const seriesA = await ensureSeriesCollection(container, `Series A ${suffix()}`)
    const seriesB = await ensureSeriesCollection(container, `Series B ${suffix()}`)
    expect(seriesA).not.toBe(seriesB)
  }, 30000)
})
