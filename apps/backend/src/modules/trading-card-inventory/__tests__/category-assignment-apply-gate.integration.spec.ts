import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection, Modules } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../../trading-cards"
import { TRADING_CARD_INVENTORY_MODULE } from "../index"
import { EBAY_INTEGRATION_MODULE } from "../../ebay-integration"

/**
 * PR review fix: the reviewer-confirmed eBay Store category must be
 * re-validated ACTIVE (and Medusa-synced) at the exact moment a NEW_HOLDING
 * proposal is locally applied — never trusted from confirmation time alone,
 * since the category can be removed or desynced in between. This exercises
 * `TradingCardInventoryModuleService#applyInventoryProposal`'s own gate
 * directly, inside the same transaction that moves stock.
 */
let pgConnection: ReturnType<typeof createPgConnection>
let rootConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cards: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let inventory: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ebayIntegration: any

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

beforeAll(async () => {
  rootConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  pgConnection = (await rootConnection.transaction()) as never
  medusaApp = await MedusaApp({
    modulesConfig: {
      [TRADING_CARD_INVENTORY_MODULE]: { resolve: "./src/modules/trading-card-inventory" },
      [TRADING_CARDS_MODULE]: { resolve: "./src/modules/trading-cards", definition: { key: TRADING_CARDS_MODULE, isQueryable: true } },
      [EBAY_INTEGRATION_MODULE]: { resolve: "./src/modules/ebay-integration" },
    },
    injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection },
    cwd: process.cwd(),
  })
  await medusaApp.onApplicationStart()
  cards = medusaApp.modules[TRADING_CARDS_MODULE]
  inventory = medusaApp.modules[TRADING_CARD_INVENTORY_MODULE]
  ebayIntegration = medusaApp.modules[EBAY_INTEGRATION_MODULE]
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
    card_set_id: set.id, name: `Gate Card ${id}`, search_name: `gate card ${id}`,
    card_number: "001", card_number_normalised: "001", origin: "MANUAL",
  })
  const variant = await cards.createTradingCardVariants({
    trading_card_id: card.id, condition: "NEAR_MINT", condition_source: "EXPLICIT", finish: "NORMAL", finish_confirmed: true,
    special_treatment: "NONE", special_treatment_confirmed: true, sku: `SKU-GATE-${id.toUpperCase()}`, origin: "MANUAL", price_locked: false,
  })
  return { variant }
}

async function sourceFixture() {
  const id = suffix()
  return inventory.createInventorySources({ display_name: `Gate Source ${id}`, provider: "PULSE" })
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

async function approvedProposalFixture(input: {
  sourceId: string
  variantId: string
  confirmedCategoryId?: string | null
}) {
  const proposalId = `tciprop_gate_${suffix()}`
  await pgConnection.raw(
    `insert into trading_card_inventory_proposal
      (id, inventory_source_id, trading_card_variant_id, change_kind, review_status, proposed_quantity, previous_quantity,
       resolved_by, resolved_at, confirmed_ebay_store_category_id, category_confirmed_at, category_confirmed_by)
     values (?, ?, ?, 'NEW_HOLDING', 'APPROVED', 3, 0, 'reviewer', now(), ?, ?, ?)`,
    [
      proposalId, input.sourceId, input.variantId,
      input.confirmedCategoryId ?? null,
      input.confirmedCategoryId ? new Date() : null,
      input.confirmedCategoryId ? "reviewer" : null,
    ],
  )
  return proposalId
}

describe("applyInventoryProposal — E2B category re-validation gate", () => {
  it("rejects a NEW_HOLDING proposal and clears the stale confirmation when the confirmed category has since been removed", async () => {
    const scope = await connectedEbayScope()
    const category = await ebayIntegration.createStoreCategory({
      environment: scope.environment, externalId: `ext_${suffix()}`, name: "Reverse Holos",
      parentExternalId: null, siblingOrder: 0, actorId: "test-actor", correlationId: suffix(),
    })
    await ebayIntegration.linkStoreCategoryToMedusaCategory(category.id, `pcat_${suffix()}`)
    await ebayIntegration.removeStoreCategory({
      environment: scope.environment, id: category.id, reason: "test removal", actorId: "test-actor", correlationId: suffix(),
    })

    const { variant } = await cardVariantFixture()
    const source = await sourceFixture()
    const proposalId = await approvedProposalFixture({ sourceId: source.id, variantId: variant.id, confirmedCategoryId: category.id })

    const result = await inventory.applyInventoryProposal({ actor: "test-actor", source: "MANUAL", id: proposalId })
    expect(result.localApplicationStatus).toBe("INVALID_STATE")
    expect(result.errorCode).toBe("CATEGORY_NO_LONGER_ACTIVE")

    const [saved] = (await pgConnection.raw(
      `select confirmed_ebay_store_category_id, category_confirmed_at, category_confirmed_by, review_status
       from trading_card_inventory_proposal where id = ?`, [proposalId],
    )).rows
    expect(saved.confirmed_ebay_store_category_id).toBeNull()
    expect(saved.category_confirmed_at).toBeNull()
    expect(saved.category_confirmed_by).toBeNull()
    expect(saved.review_status).toBe("APPROVED")
  }, 60000)

  it("rejects a NEW_HOLDING proposal whose confirmed category is active but not yet synced to Medusa", async () => {
    const scope = await connectedEbayScope()
    const category = await ebayIntegration.createStoreCategory({
      environment: scope.environment, externalId: `ext_${suffix()}`, name: "Illustration Rares",
      parentExternalId: null, siblingOrder: 0, actorId: "test-actor", correlationId: suffix(),
    })
    // Deliberately never synced — medusa_category_id stays null.

    const { variant } = await cardVariantFixture()
    const source = await sourceFixture()
    const proposalId = await approvedProposalFixture({ sourceId: source.id, variantId: variant.id, confirmedCategoryId: category.id })

    const result = await inventory.applyInventoryProposal({ actor: "test-actor", source: "MANUAL", id: proposalId })
    expect(result.localApplicationStatus).toBe("INVALID_STATE")
    expect(result.errorCode).toBe("CATEGORY_NOT_SYNCED")
  }, 60000)

  it("rejects a NEW_HOLDING proposal with no confirmed category at all", async () => {
    const { variant } = await cardVariantFixture()
    const source = await sourceFixture()
    const proposalId = await approvedProposalFixture({ sourceId: source.id, variantId: variant.id, confirmedCategoryId: null })

    const result = await inventory.applyInventoryProposal({ actor: "test-actor", source: "MANUAL", id: proposalId })
    expect(result.localApplicationStatus).toBe("INVALID_STATE")
    expect(result.errorCode).toBe("CATEGORY_NOT_CONFIRMED")
  }, 60000)

  it("applies a NEW_HOLDING proposal whose confirmed category is active and synced", async () => {
    const scope = await connectedEbayScope()
    const category = await ebayIntegration.createStoreCategory({
      environment: scope.environment, externalId: `ext_${suffix()}`, name: "Graded Cards",
      parentExternalId: null, siblingOrder: 0, actorId: "test-actor", correlationId: suffix(),
    })
    await ebayIntegration.linkStoreCategoryToMedusaCategory(category.id, `pcat_${suffix()}`)

    const { variant } = await cardVariantFixture()
    const source = await sourceFixture()
    const proposalId = await approvedProposalFixture({ sourceId: source.id, variantId: variant.id, confirmedCategoryId: category.id })

    const result = await inventory.applyInventoryProposal({ actor: "test-actor", source: "MANUAL", id: proposalId })
    expect(result.localApplicationStatus).toBe("APPLIED")
  }, 60000)
})
