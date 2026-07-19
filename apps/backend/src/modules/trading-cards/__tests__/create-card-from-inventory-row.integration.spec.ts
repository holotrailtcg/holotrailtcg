import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { asValue } from "@medusajs/framework/awilix"
import { ContainerRegistrationKeys, createPgConnection, Modules } from "@medusajs/framework/utils"
import type { IProductModuleService, IStockLocationService } from "@medusajs/framework/types"
import { TRADING_CARDS_MODULE } from "../index"
import { TRADING_CARD_INVENTORY_MODULE } from "../../trading-card-inventory"
import type { IInventoryService } from "@medusajs/framework/types"
import { CARD_GAME, CARD_LANGUAGE, CARD_CONDITION, CARD_FINISH, SPECIAL_TREATMENT } from "../types"
import { createCardFromInventoryRowWorkflow, type CreateCardFromInventoryRowInput } from "../../../workflows/trading-cards/create-card-from-inventory-row"
import { syncInventoryProposalToMedusa } from "../../../workflows/trading-card-inventory/medusa-inventory-sync"
import "../../../links/trading-card-product"
import "../../../links/trading-card-variant-product-variant"

// This suite calls the real workflow against real Medusa product/inventory
// modules, so — unlike the shared-outer-transaction pattern used by
// module-only specs — it commits for real, the same way
// `tcgdex-enrichment-persistence.integration.spec.ts` does. Genuine
// concurrent execution (two overlapping workflow runs racing against real
// unique constraints) is not expressible against a single uncommitted
// transaction, which serialises everything issued through it. Every fixture
// id below is suffixed uniquely per test run, so nothing here can collide
// with — or need to clean up — other tests' rows in the shared test database.
//
// This file boots both TRADING_CARDS_MODULE and TRADING_CARD_INVENTORY_MODULE
// in its own MedusaApp, so it must be isolated from every other spec that
// does the same (see the loader-registry note at the top of jest.config.js)
// — it is chained as its own `--runTestsByPath` invocation in
// `test:integration:modules`, not picked up by the broad pass.

let pgConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let inventory: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cards: any
let container: ReturnType<typeof buildContainer>

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`
// cardNumber must satisfy CARD_NUMBER_PATTERN (digits, optional letter
// prefix/suffix, optional /denominator) — unlike `suffix()`, which is used
// for set codes, names, etc. and may contain any characters.
const numericSuffix = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`

function buildContainer() {
  if (!medusaApp.sharedContainer) throw new Error("Expected Medusa shared container")
  return medusaApp.sharedContainer
}

beforeAll(async () => {
  pgConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
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
  cards = medusaApp.modules[TRADING_CARDS_MODULE]
  inventory = medusaApp.modules[TRADING_CARD_INVENTORY_MODULE]
  container = buildContainer()
}, 60000)

const createdStockLocationIds: string[] = []

afterAll(async () => {
  // This suite commits for real (see the note above) — unlike the
  // rolled-back-transaction pattern, anything created here persists in the
  // shared test database unless explicitly removed. Stock locations in
  // particular are read by *other* specs (e.g.
  // `medusa-inventory-sync.integration.spec.ts`'s "no stock location exists"
  // / "exactly one stock location" assertions) that assume a clean slate, so
  // this suite must never leave its own behind.
  if (createdStockLocationIds.length > 0) {
    const stockLocations = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
    await stockLocations.deleteStockLocations(createdStockLocationIds)
  }
  await medusaApp?.onApplicationPrepareShutdown()
  await medusaApp?.onApplicationShutdown()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (pgConnection as any)?.context?.destroy()
  await pgConnection?.destroy()
})

async function createStockLocation(name: string) {
  const stockLocations = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  const location = await stockLocations.createStockLocations({ name })
  createdStockLocationIds.push(location.id)
  return location
}

async function createSource() {
  const id = suffix()
  return inventory.createInventorySource({ displayName: `Create Card Workflow Source ${id}`, provider: "PULSE", actor: "test-actor", source: "MANUAL" })
}

/**
 * Builds an UNRESOLVED_VARIANT proposal the way the real pipeline does — an
 * entry with no variant, an UNMATCHED match row for it, then reconciliation
 * derives the proposal. Mirrors the identical helper in
 * `trading-card-inventory-module.spec.ts`.
 */
async function unresolvedVariantProposal(sourceId: string, providerReference: string) {
  const snapshot = await inventory.createInventorySnapshot({ inventorySourceId: sourceId, actor: "test-actor", source: "MANUAL" })
  await inventory.addInventorySnapshotEntries({
    snapshotId: snapshot.id, actor: "test-actor", source: "MANUAL",
    entries: [{
      providerReference, providerReferenceType: "PULSE_PRODUCT_ID", tradingCardVariantId: null,
      quantity: 1, currencyCode: "GBP", unitAcquisitionCost: "1.00", unitMarketPrice: "2.00", unitSellingPrice: "3.00",
    }],
  })
  await inventory.transitionInventorySnapshotStatus({ id: snapshot.id, targetStatus: "VALIDATED", actor: "test-actor", source: "MANUAL" })
  const [entry] = await inventory.listInventorySnapshotEntries({ inventory_snapshot_id: snapshot.id, provider_reference: providerReference })
  await inventory.recordSnapshotEntryMatch({
    snapshotEntryId: entry.id, inventorySnapshotId: snapshot.id, matchingStatus: "UNMATCHED", matchedVia: "NONE",
    diagnostics: [], actor: "test-actor", source: "SYSTEM",
  })
  await inventory.reconcileInventorySnapshot({ inventorySourceId: sourceId, snapshotId: snapshot.id, actor: "reconciler", source: "SYSTEM" })
  const [proposal] = await inventory.listInventoryProposals({ inventory_snapshot_id: snapshot.id, provider_reference: providerReference })
  return proposal
}

/** A plain TradingCardVariant linked to its own real Product/ProductVariant/InventoryItem, with no inventory level yet. */
async function cardVariantWithoutLevelFixture() {
  const id = suffix()
  const set = await cards.createCardSets({ game: "POKEMON", language: "EN", display_name: `Level Test Set ${id}`, provider_set_code: `set_level_${id}` })
  const card = await cards.createTradingCards({
    card_set_id: set.id, name: `Level Test Card ${id}`, search_name: `level test card ${id}`,
    card_number: "001", card_number_normalised: "001", origin: "MANUAL",
  })
  const variant = await cards.createTradingCardVariants({
    trading_card_id: card.id, condition: "NEAR_MINT", condition_source: "EXPLICIT", finish: "NORMAL", finish_confirmed: true,
    special_treatment: "NONE", special_treatment_confirmed: true, sku: `SKU-LVL-${id.toUpperCase()}`, origin: "MANUAL", price_locked: false,
  })
  const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const product = await products.createProducts({
    title: `Level Test Product ${id}`, status: "draft", variants: [{ title: "Near Mint", manage_inventory: false, sku: `PV-LVL-${id}` }],
  })
  const productVariant = product.variants?.[0]
  if (!productVariant) throw new Error("Expected created product variant")
  const link = medusaApp.link
  if (!link) throw new Error("Expected Medusa link container")
  await link.create({
    [Modules.PRODUCT]: { product_variant_id: productVariant.id }, [TRADING_CARDS_MODULE]: { trading_card_variant_id: variant.id },
  })
  const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)
  const item = await inventoryService.createInventoryItems({ sku: `ITEM-LVL-${id}` })
  await link.create({ [Modules.PRODUCT]: { variant_id: productVariant.id }, [Modules.INVENTORY]: { inventory_item_id: item.id } })
  return { variant, item }
}

function baseCardInput(overrides: Partial<CreateCardFromInventoryRowInput> = {}): Omit<CreateCardFromInventoryRowInput, "proposalId" | "claimToken"> {
  return {
    actor: "reviewer", source: "MANUAL",
    cardSetProviderSetCode: overrides.cardSetProviderSetCode ?? `set_${suffix()}`,
    cardSetDisplayName: "Concurrency Test Set",
    cardGame: CARD_GAME.POKEMON, cardLanguage: CARD_LANGUAGE.EN,
    name: overrides.name ?? "Concurrency Test Card",
    cardNumber: overrides.cardNumber ?? "001",
    rarityRaw: null,
    condition: CARD_CONDITION.NEAR_MINT, finish: CARD_FINISH.NORMAL, specialTreatment: SPECIAL_TREATMENT.NONE,
    finishConfirmed: true, specialTreatmentConfirmed: true,
    ...overrides,
  }
}

describe("createCardFromInventoryRowWorkflow — orphan-safety and cross-proposal concurrency (Stage 5B.3)", () => {
  it(
    "two concurrent unresolved proposals for the same never-before-seen card converge on exactly one identity chain",
    async () => {
      // Explicitly configured rather than relying on "exactly one location
      // exists": this suite's tests accumulate real stock-location rows
      // across the whole file (cleaned up only once, in `afterAll`), so a
      // later test in this same run cannot assume it is the only location —
      // the same Stage 5B.2 policy (Phase 7) this now goes through would
      // otherwise correctly refuse to guess.
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      try {
        const source = await createSource()
        const proposalA = await unresolvedVariantProposal(source.id, `race-a-${suffix()}`)
        const proposalB = await unresolvedVariantProposal(source.id, `race-b-${suffix()}`)
        const claimA = await inventory.beginCardCreationClaim({ proposalId: proposalA.id, actor: "reviewer-a", source: "MANUAL" })
        const claimB = await inventory.beginCardCreationClaim({ proposalId: proposalB.id, actor: "reviewer-b", source: "MANUAL" })
        expect(claimA.claimToken).toBeTruthy()
        expect(claimB.claimToken).toBeTruthy()

        const shared = baseCardInput({ cardSetProviderSetCode: `set_race_${suffix()}`, cardNumber: numericSuffix(), name: "Race Card" })

        const [resultA, resultB] = await Promise.all([
          createCardFromInventoryRowWorkflow(container).run({
            input: { ...shared, proposalId: proposalA.id, claimToken: claimA.claimToken as string },
          }),
          createCardFromInventoryRowWorkflow(container).run({
            input: { ...shared, proposalId: proposalB.id, claimToken: claimB.claimToken as string },
          }),
        ])

        // Both concurrent callers must converge on the exact same identity chain.
        expect(resultA.result.tradingCardId).toBe(resultB.result.tradingCardId)
        expect(resultA.result.productId).toBe(resultB.result.productId)
        expect(resultA.result.tradingCardVariantId).toBe(resultB.result.tradingCardVariantId)
        expect(resultA.result.productVariantId).toBe(resultB.result.productVariantId)

        // Exactly one row at every layer of the chain — no duplicate created by the loser of the race.
        const matchingCardSets = await cards.listCardSets({
          game: shared.cardGame, language: shared.cardLanguage, provider_set_code: shared.cardSetProviderSetCode,
        })
        expect(matchingCardSets).toHaveLength(1)

        const matchingCards = await cards.listTradingCards({
          card_set_id: matchingCardSets[0].id, card_number_normalised: shared.cardNumber,
        })
        expect(matchingCards).toHaveLength(1)

        const matchingVariants = await cards.listTradingCardVariants({
          trading_card_id: matchingCards[0].id, condition: shared.condition, finish: shared.finish, special_treatment: shared.specialTreatment,
        })
        expect(matchingVariants).toHaveLength(1)

        const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
        const product = await products.retrieveProduct(resultA.result.productId, { relations: ["variants"] })
        expect(product.variants).toHaveLength(1)

        // Reuse over creation: the loser's own product/item never persisted.
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const { data: variantChain } = await query.graph({
          entity: "trading_card_variant",
          fields: ["id", "product_variant.id", "product_variant.inventory_items.inventory_item_id"],
          filters: { id: resultA.result.tradingCardVariantId },
        })
        const linkedInventoryItems = (variantChain[0]?.product_variant as { inventory_items?: unknown[] } | null)?.inventory_items ?? []
        expect(linkedInventoryItems).toHaveLength(1)

        // Safe retry / idempotent replay: both originating proposals resolved, no orphan unresolved proposal left behind.
        const refreshedA = await inventory.retrieveInventoryProposal(proposalA.id)
        const refreshedB = await inventory.retrieveInventoryProposal(proposalB.id)
        expect(refreshedA).toMatchObject({ change_kind: "NEW_HOLDING", trading_card_variant_id: resultA.result.tradingCardVariantId, card_creation_claim_token: null })
        expect(refreshedB).toMatchObject({ change_kind: "NEW_HOLDING", trading_card_variant_id: resultB.result.tradingCardVariantId, card_creation_claim_token: null })
      } finally {
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    60000,
  )

  it(
    "two concurrent requests for a second variant on the same existing card also converge on one TradingCardVariant/ProductVariant/InventoryItem",
    async () => {
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      try {
        const source = await createSource()
        const setCode = `set_variant_race_${suffix()}`
        const cardNumber = numericSuffix()
        const seedInput = baseCardInput({ cardSetProviderSetCode: setCode, cardNumber, name: "Variant Race Card" })

        // Seed the card itself first (its own single-caller path is already covered above).
        const seedProposal = await unresolvedVariantProposal(source.id, `variant-race-seed-${suffix()}`)
        const seedClaim = await inventory.beginCardCreationClaim({ proposalId: seedProposal.id, actor: "seed", source: "MANUAL" })
        await createCardFromInventoryRowWorkflow(container).run({
          input: { ...seedInput, proposalId: seedProposal.id, claimToken: seedClaim.claimToken as string },
        })

        // Now race two *different* reviewers both adding the same new
        // (condition, finish, specialTreatment) combination to that existing card.
        const proposalA = await unresolvedVariantProposal(source.id, `variant-race-a-${suffix()}`)
        const proposalB = await unresolvedVariantProposal(source.id, `variant-race-b-${suffix()}`)
        const claimA = await inventory.beginCardCreationClaim({ proposalId: proposalA.id, actor: "reviewer-a", source: "MANUAL" })
        const claimB = await inventory.beginCardCreationClaim({ proposalId: proposalB.id, actor: "reviewer-b", source: "MANUAL" })

        const secondVariantInput = baseCardInput({
          cardSetProviderSetCode: setCode, cardNumber, name: "Variant Race Card",
          condition: CARD_CONDITION.LIGHTLY_PLAYED, finish: CARD_FINISH.NORMAL, specialTreatment: SPECIAL_TREATMENT.NONE,
          finishConfirmed: true, specialTreatmentConfirmed: true,
        })

        const [resultA, resultB] = await Promise.all([
          createCardFromInventoryRowWorkflow(container).run({
            input: { ...secondVariantInput, proposalId: proposalA.id, claimToken: claimA.claimToken as string },
          }),
          createCardFromInventoryRowWorkflow(container).run({
            input: { ...secondVariantInput, proposalId: proposalB.id, claimToken: claimB.claimToken as string },
          }),
        ])

        expect(resultA.result.tradingCardId).toBe(resultB.result.tradingCardId)
        expect(resultA.result.tradingCardVariantId).toBe(resultB.result.tradingCardVariantId)
        expect(resultA.result.productVariantId).toBe(resultB.result.productVariantId)

        const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
        const product = await products.retrieveProduct(resultA.result.productId, { relations: ["variants"] })
        // The original (seed) variant plus exactly one new variant — never two duplicates of the raced one.
        expect(product.variants).toHaveLength(2)

        const matchingVariants = await cards.listTradingCardVariants({
          trading_card_id: resultA.result.tradingCardId, condition: secondVariantInput.condition,
          finish: secondVariantInput.finish, special_treatment: secondVariantInput.specialTreatment,
        })
        expect(matchingVariants).toHaveLength(1)
      } finally {
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    60000,
  )

  it(
    "leaves no orphan CardSet, TradingCard, Product, TradingCardVariant, ProductVariant or InventoryItem when the final proposal-resolution step fails",
    async () => {
      // A stale claim token is a genuine, deterministic failure at the very
      // last step (`resolve-proposal`) — everything before it (CardSet,
      // TradingCard+Product, TradingCardVariant+ProductVariant+InventoryItem)
      // has already been created by the time it runs. This exercises full
      // end-to-end orchestrator rollback across every earlier step's own
      // compensation, not just one step's inline catch-cleanup in isolation.
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      try {
        const source = await createSource()
        const proposal = await unresolvedVariantProposal(source.id, `orphan-fail-${suffix()}`)
        const claim = await inventory.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })
        const setCode = `set_orphan_${suffix()}`
        const cardNumber = numericSuffix()
        const input = baseCardInput({ cardSetProviderSetCode: setCode, cardNumber, name: "Orphan Guard Card" })
        void claim // the real claim token is deliberately never used below

        // Not `.rejects.toThrow()`: the workflow engine's transaction
        // orchestrator round-trips a failed step's error through its own
        // checkpoint/transaction-state handling before `.run()` rethrows it,
        // which does not preserve the original error's prototype chain (see
        // `CatalogueIntegrityError.isCatalogueIntegrityError`'s comment in the
        // workflow file for the same phenomenon) — the rejection reason is
        // Error-*shaped* but not `instanceof Error`, which `toThrow` requires.
        await expect(createCardFromInventoryRowWorkflow(container).run({
          input: { ...input, proposalId: proposal.id, claimToken: "not-the-real-claim-token" },
        })).rejects.toMatchObject({ message: expect.stringMatching(/stale/i) })

        const matchingCardSets = await cards.listCardSets({ provider_set_code: setCode })
        expect(matchingCardSets).toHaveLength(0)
        const matchingCards = await cards.listTradingCards({ card_number: cardNumber })
        expect(matchingCards).toHaveLength(0)

        const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
        const orphanProducts = await products.listProducts({ title: input.name })
        expect(orphanProducts).toHaveLength(0)

        // The claim itself must not be left dangling on a proposal that never resolved.
        const refreshedProposal = await inventory.retrieveInventoryProposal(proposal.id)
        expect(refreshedProposal.trading_card_variant_id).toBeNull()
        expect(refreshedProposal.card_creation_claim_token).toBe(claim.claimToken)
      } finally {
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    30000,
  )
})

describe("Stage 5B.2 stock-location policy, reused by card creation (Phase 7)", () => {
  it(
    "createCardFromInventoryRowWorkflow fails clearly (AMBIGUOUS_STOCK_LOCATION) rather than silently picking a location, when more than one exists and none is configured",
    async () => {
      await createStockLocation(`Loc ${suffix()}`)
      await createStockLocation(`Loc ${suffix()}`)
      const source = await createSource()
      const proposal = await unresolvedVariantProposal(source.id, `ambiguous-loc-${suffix()}`)
      const claim = await inventory.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })
      const setCode = `set_ambiguous_${suffix()}`
      const cardNumber = numericSuffix()
      const input = baseCardInput({ cardSetProviderSetCode: setCode, cardNumber, name: `Ambiguous Location Card ${suffix()}` })

      await expect(createCardFromInventoryRowWorkflow(container).run({
        input: { ...input, proposalId: proposal.id, claimToken: claim.claimToken as string },
      })).rejects.toMatchObject({ message: expect.stringMatching(/AMBIGUOUS_STOCK_LOCATION/) })

      // No orphan chain left behind by the failed attempt.
      const matchingCardSets = await cards.listCardSets({ provider_set_code: setCode })
      expect(matchingCardSets).toHaveLength(0)
      const matchingCards = await cards.listTradingCards({ card_number: cardNumber })
      expect(matchingCards).toHaveLength(0)
      const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
      const orphanProducts = await products.listProducts({ title: input.name })
      expect(orphanProducts).toHaveLength(0)
    },
    30000,
  )

  it(
    "createCardFromInventoryRowWorkflow uses the explicitly configured stock location (not just 'the first') when more than one exists",
    async () => {
      await createStockLocation(`Loc ${suffix()}`)
      const configured = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = configured.id
      try {
        const source = await createSource()
        const proposal = await unresolvedVariantProposal(source.id, `configured-loc-${suffix()}`)
        const claim = await inventory.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })
        const input = baseCardInput({ cardSetProviderSetCode: `set_configured_${suffix()}`, cardNumber: numericSuffix(), name: "Configured Location Card" })

        const { result } = await createCardFromInventoryRowWorkflow(container).run({
          input: { ...input, proposalId: proposal.id, claimToken: claim.claimToken as string },
        })

        const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({
          entity: "trading_card_variant",
          fields: ["id", "product_variant.inventory_items.inventory_item_id"],
          filters: { id: result.tradingCardVariantId },
        })
        const productVariant = data[0]?.product_variant as { inventory_items?: Array<{ inventory_item_id?: string }> } | undefined
        const inventoryItemId = productVariant?.inventory_items?.[0]?.inventory_item_id as string
        const level = await inventoryService.retrieveInventoryLevelByItemAndLocation(inventoryItemId, configured.id)
        expect(level.location_id).toBe(configured.id)
      } finally {
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    30000,
  )

  it(
    "two concurrent syncInventoryProposalToMedusa calls for a brand-new item+location create exactly one inventory level, never a raw conflict failure",
    async () => {
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      try {
        const { variant, item } = await cardVariantWithoutLevelFixture()

        const [resultA, resultB] = await Promise.all([
          syncInventoryProposalToMedusa(container, {
            proposalId: "tciprop_race_a", tradingCardVariantId: variant.id, proposedQuantity: 4, attemptToken: `race-a-${suffix()}`,
          }),
          syncInventoryProposalToMedusa(container, {
            proposalId: "tciprop_race_b", tradingCardVariantId: variant.id, proposedQuantity: 9, attemptToken: `race-b-${suffix()}`,
          }),
        ])

        // Neither concurrent caller sees a raw duplicate-key failure — the
        // loser of the create race recovers by switching to an update.
        expect(resultA.outcome).toBe("SYNCED")
        expect(resultB.outcome).toBe("SYNCED")

        const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)
        const level = await inventoryService.retrieveInventoryLevelByItemAndLocation(item.id, location.id)
        // Exactly one level row exists (the DB's own unique (item, location)
        // constraint is the real backstop; retrieving it at all — rather than
        // throwing "not found" or a duplicate-row ambiguity error — proves
        // there is exactly one), and its quantity is one of the two proposed
        // values (whichever write landed last), never a corrupted merge of both.
        expect([4, 9]).toContain(level.stocked_quantity)
      } finally {
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    30000,
  )

  it(
    "retry behaviour: re-syncing the same item+location after a level already exists updates it, never creates a second row",
    async () => {
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      try {
        const { variant, item } = await cardVariantWithoutLevelFixture()

        const first = await syncInventoryProposalToMedusa(container, {
          proposalId: "tciprop_retry", tradingCardVariantId: variant.id, proposedQuantity: 6, attemptToken: `retry-first-${suffix()}`,
        })
        expect(first.outcome).toBe("SYNCED")

        // Simulate a retry of the same proposal (e.g. a superseded worker
        // recovering) — same item+location, a fresh attempt token.
        const retried = await syncInventoryProposalToMedusa(container, {
          proposalId: "tciprop_retry", tradingCardVariantId: variant.id, proposedQuantity: 11, attemptToken: `retry-second-${suffix()}`,
        })
        expect(retried.outcome).toBe("SYNCED")

        const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)
        const level = await inventoryService.retrieveInventoryLevelByItemAndLocation(item.id, location.id)
        expect(level.stocked_quantity).toBe(11) // absolute value from the retry, never a delta or duplicate row
      } finally {
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    30000,
  )
})

describe("Phase 8B: reuse of a card migrated from the pre-normalisation-policy algorithm", () => {
  it(
    "an existing TradingCard whose card_number_normalised has already been re-normalised by Migration20260718160000 is reused, not duplicated, by a fresh create-from-inventory-row request",
    async () => {
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      try {
        const id = suffix()
        const setCode = `set_legacy_${id}`
        // `card_number_normalised: "044"` is exactly what Migration20260718160000
        // would leave behind for a legacy row originally written as
        // "044/072" — `card_number` itself is untouched by that migration
        // (it only ever rewrites `card_number_normalised`), so a real
        // migrated row keeps its original denominator-inclusive display value.
        const set = await cards.createCardSets({
          game: "POKEMON", language: "EN", display_name: `Legacy Set ${id}`, provider_set_code: setCode,
        })
        const legacyCard = await cards.createTradingCards({
          card_set_id: set.id, name: `Legacy Card ${id}`, search_name: `legacy card ${id}`,
          card_number: "044/072", card_number_normalised: "044", origin: "PULSE",
        })
        // `resolveProductIdForTradingCard` requires the TradingCard itself
        // (not just a variant) to be linked to a real Medusa Product before
        // reuse can complete — mirrors what the real create-from-inventory-row
        // workflow always does for a brand-new card.
        const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
        const legacyProduct = await products.createProducts({
          title: `Legacy Card ${id}`, status: "draft",
          // A pre-existing variant under a *different* commercial combination
          // than the one this test will request, so the reuse path below is
          // forced to add a genuinely new variant to this existing product —
          // matching the real "Card Variant" option shape the create-workflow
          // itself always sets up (see `variantOptionValue`/`addCardVariantOptionValue`).
          options: [{ title: "Card Variant", values: ["LIGHTLY PLAYED · HOLO"] }],
          variants: [{ title: "LIGHTLY PLAYED · HOLO", sku: `PV-LEGACY-${id}`, manage_inventory: true, options: { "Card Variant": "LIGHTLY PLAYED · HOLO" } }],
        })
        const link = medusaApp.link
        if (!link) throw new Error("Expected Medusa link container")
        await link.create({ [Modules.PRODUCT]: { product_id: legacyProduct.id }, [TRADING_CARDS_MODULE]: { trading_card_id: legacyCard.id } })

        const source = await createSource()
        const proposal = await unresolvedVariantProposal(source.id, `legacy-reuse-${id}`)
        const claim = await inventory.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })

        // A brand-new request for the exact same physical card, submitted
        // with the denominator-inclusive form — the shape a fresh Pulse row
        // for this same card would still carry, since Pulse itself always
        // includes the denominator.
        const input = baseCardInput({
          cardSetProviderSetCode: setCode, cardSetDisplayName: `Legacy Set ${id}`,
          cardNumber: "044/072", name: `Legacy Card ${id}`,
        })

        const { result } = await createCardFromInventoryRowWorkflow(container).run({
          input: { ...input, proposalId: proposal.id, claimToken: claim.claimToken as string },
        })

        // Reused the existing (migrated) TradingCard and its Product — no second row for the same card.
        expect(result.tradingCardId).toBe(legacyCard.id)
        expect(result.productId).toBe(legacyProduct.id)
        const matchingCards = await cards.listTradingCards({ card_set_id: set.id, card_number_normalised: "044" })
        expect(matchingCards).toHaveLength(1)
      } finally {
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    30000,
  )
})
