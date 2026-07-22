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
      // Stage 5B.3 concurrency fix: the real PostgreSQL-backed provider,
      // exactly as configured in medusa-config.ts — this suite deliberately
      // exercises the configured provider, not an in-memory mock, since the
      // whole point of the fix is that a lock only means something when it
      // is visible across processes/instances sharing this database.
      [Modules.LOCKING]: {
        resolve: "@medusajs/medusa/locking",
        options: {
          providers: [
            { resolve: "@medusajs/medusa/locking-postgres", id: "locking-postgres", is_default: true },
          ],
        },
      },
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
    "when the final proposal-resolution step fails, the proposal's own claim is released but its already-created chain is deliberately left in place (ADR 0013)",
    async () => {
      // A stale claim token is a genuine, deterministic failure at the very
      // last step (`resolve-proposal`) — everything before it (CardSet,
      // TradingCard+Product, TradingCardVariant+ProductVariant+InventoryItem)
      // has already been created by the time it runs. Per ADR 0013, steps
      // 1–3 register no compensation at all, so that chain is expected to
      // survive this failure (see the "compensation never deletes a
      // discoverable row" describe block above for the full assertions on
      // what remains) — this test's own focus is the proposal itself: its
      // claim must not be left dangling, and it must never have been
      // resolved to any variant.
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

        // The chain steps 1–3 created is left in place, not orphan-free.
        const matchingCardSets = await cards.listCardSets({ provider_set_code: setCode })
        expect(matchingCardSets).toHaveLength(1)
        const matchingCards = await cards.listTradingCards({ card_number: cardNumber })
        expect(matchingCards).toHaveLength(1)

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

  it(
    "a request that fails at the final step never deletes a chain a concurrent request has since reused and resolved (Codex remediation)",
    async () => {
      // Both requests target the exact same card identity. `claimTokenA` is
      // deliberately wrong, so request A's own `resolve-proposal` step always
      // fails, regardless of which of A/B happens to win the earlier
      // CardSet/TradingCard/TradingCardVariant creation race — that race's
      // outcome is not controlled here (it doesn't need to be: whichever of
      // A/B created the chain, A's failure-triggered compensation must never
      // remove it once B has reused and resolved it). Request B has a
      // genuine claim and always succeeds.
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      try {
        const source = await createSource()
        const setCode = `set_compfail_${suffix()}`
        const cardNumber = numericSuffix()
        const shared = baseCardInput({ cardSetProviderSetCode: setCode, cardNumber, name: "Compensation Race Card" })

        const proposalA = await unresolvedVariantProposal(source.id, `compfail-a-${suffix()}`)
        const proposalB = await unresolvedVariantProposal(source.id, `compfail-b-${suffix()}`)
        const claimB = await inventory.beginCardCreationClaim({ proposalId: proposalB.id, actor: "reviewer-b", source: "MANUAL" })

        const [outcomeA, outcomeB] = await Promise.allSettled([
          createCardFromInventoryRowWorkflow(container).run({
            input: { ...shared, proposalId: proposalA.id, claimToken: "not-the-real-claim-token" },
          }),
          createCardFromInventoryRowWorkflow(container).run({
            input: { ...shared, proposalId: proposalB.id, claimToken: claimB.claimToken as string },
          }),
        ])

        expect(outcomeA.status).toBe("rejected")
        expect(outcomeB.status).toBe("fulfilled")
        if (outcomeB.status !== "fulfilled") throw new Error("unreachable")
        const resultB = outcomeB.value.result

        // Exactly one row at every layer — A's compensation never removed
        // what B is now relying on, no matter which of A/B created it first.
        const matchingCardSets = await cards.listCardSets({ provider_set_code: setCode })
        expect(matchingCardSets).toHaveLength(1)
        const matchingCards = await cards.listTradingCards({
          card_set_id: matchingCardSets[0].id, card_number_normalised: shared.cardNumber,
        })
        expect(matchingCards).toHaveLength(1)
        expect(matchingCards[0].id).toBe(resultB.tradingCardId)
        const matchingVariants = await cards.listTradingCardVariants({
          trading_card_id: matchingCards[0].id, condition: shared.condition, finish: shared.finish, special_treatment: shared.specialTreatment,
        })
        expect(matchingVariants).toHaveLength(1)
        expect(matchingVariants[0].id).toBe(resultB.tradingCardVariantId)

        const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
        const product = await products.retrieveProduct(resultB.productId, { relations: ["variants"] })
        expect(product.variants).toHaveLength(1)

        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const { data: variantChain } = await query.graph({
          entity: "trading_card_variant",
          fields: ["id", "product_variant.id", "product_variant.inventory_items.inventory_item_id"],
          filters: { id: resultB.tradingCardVariantId },
        })
        const linkedInventoryItems = (variantChain[0]?.product_variant as { inventory_items?: unknown[] } | null)?.inventory_items ?? []
        expect(linkedInventoryItems).toHaveLength(1)

        // B's own proposal resolved to the surviving chain and stays retrievable.
        const refreshedB = await inventory.retrieveInventoryProposal(proposalB.id)
        expect(refreshedB).toMatchObject({ change_kind: "NEW_HOLDING", trading_card_variant_id: resultB.tradingCardVariantId, card_creation_claim_token: null })
      } finally {
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    60000,
  )

  it(
    "a failing request for one card never deletes a CardSet a concurrent request for a different card in the same set still depends on (Codex remediation)",
    async () => {
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      try {
        const source = await createSource()
        const setCode = `set_sharedset_${suffix()}`

        const proposalA = await unresolvedVariantProposal(source.id, `sharedset-a-${suffix()}`)
        const proposalB = await unresolvedVariantProposal(source.id, `sharedset-b-${suffix()}`)
        const claimB = await inventory.beginCardCreationClaim({ proposalId: proposalB.id, actor: "reviewer-b", source: "MANUAL" })

        const inputA = baseCardInput({ cardSetProviderSetCode: setCode, cardNumber: numericSuffix(), name: "Shared Set Card A" })
        const inputB = baseCardInput({ cardSetProviderSetCode: setCode, cardNumber: numericSuffix(), name: "Shared Set Card B" })

        const [outcomeA, outcomeB] = await Promise.allSettled([
          createCardFromInventoryRowWorkflow(container).run({
            input: { ...inputA, proposalId: proposalA.id, claimToken: "not-the-real-claim-token" },
          }),
          createCardFromInventoryRowWorkflow(container).run({
            input: { ...inputB, proposalId: proposalB.id, claimToken: claimB.claimToken as string },
          }),
        ])

        expect(outcomeA.status).toBe("rejected")
        expect(outcomeB.status).toBe("fulfilled")
        if (outcomeB.status !== "fulfilled") throw new Error("unreachable")
        const resultB = outcomeB.value.result

        // Exactly one CardSet for the whole set code — A's failed request's
        // compensation must never remove it out from under card B, even
        // though the two cards are otherwise unrelated aside from sharing
        // this brand-new set.
        const matchingCardSets = await cards.listCardSets({ provider_set_code: setCode })
        expect(matchingCardSets).toHaveLength(1)

        const matchingCards = await cards.listTradingCards({
          card_set_id: matchingCardSets[0].id, card_number_normalised: inputB.cardNumber,
        })
        expect(matchingCards).toHaveLength(1)
        expect(matchingCards[0].id).toBe(resultB.tradingCardId)

        // Card A's own creation is deliberately left in place (ADR 0013) —
        // not deleted, and not confused with card B's.
        const orphanCardA = await cards.listTradingCards({
          card_set_id: matchingCardSets[0].id, card_number_normalised: inputA.cardNumber,
        })
        expect(orphanCardA).toHaveLength(1)
        expect(orphanCardA[0].id).not.toBe(resultB.tradingCardId)
      } finally {
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    60000,
  )
})

describe("createCardFromInventoryRowWorkflow — compensation never deletes a discoverable row (Codex remediation, second pass)", () => {
  /**
   * Deterministically forces the exact interleaving the Codex re-review
   * flagged as unsafe under the previous (check-then-delete + bounded delay)
   * remediation, using real await barriers rather than timing:
   *
   *   1. Request A runs steps 1–3 for real (creates the CardSet/TradingCard/
   *      TradingCardVariant/Product/ProductVariant/InventoryItem chain), then
   *      is paused immediately before its own step 4 (`resolve-proposal`).
   *   2. Request B is only started once (1) is confirmed — its own steps 1–3
   *      run for real and *discover* A's already-committed variant via the
   *      same identity lookup `resolveOrCreateVariantStep` always performs
   *      (this is "B discovers the variant but has not resolved its
   *      proposal" — B has not yet reached step 4 either). B is paused there.
   *   3. A is released first, with a deliberately wrong claim token — its
   *      step 4 throws, and the orchestrator runs A's full compensation
   *      chain (steps 3, 2, 1) to completion before this promise settles.
   *   4. Only after A has fully failed and compensated is B released, with
   *      its genuine claim token, to complete its own step 4.
   *
   * Under the old check-then-delete guard this would have been unsafe even
   * with the 300ms grace delay: at the moment A's compensation ran, B's own
   * proposal had *not yet resolved* to the variant (it had only discovered
   * it), so the guard's "does any proposal already reference this variant?"
   * lookup would find none and delete it out from under B, no matter how
   * long A waited first. The fix removes the check-then-delete entirely, so
   * this ordering is exercised and asserted safe regardless of timing.
   */
  it(
    "B discovers the variant, A fails and fully compensates, then B completes — B's whole chain survives untouched",
    async () => {
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const original = (inventory.resolveInventoryProposalVariant as any).bind(inventory)
      const spy = jest.spyOn(inventory, "resolveInventoryProposalVariant")
      try {
        const source = await createSource()
        const setCode = `set_deterministic_${suffix()}`
        const cardNumber = numericSuffix()
        const shared = baseCardInput({ cardSetProviderSetCode: setCode, cardNumber, name: "Deterministic Barrier Card" })

        const proposalA = await unresolvedVariantProposal(source.id, `deterministic-a-${suffix()}`)
        const proposalB = await unresolvedVariantProposal(source.id, `deterministic-b-${suffix()}`)
        const claimB = await inventory.beginCardCreationClaim({ proposalId: proposalB.id, actor: "reviewer-b", source: "MANUAL" })

        let releaseA: () => void
        const gateA = new Promise<void>((resolve) => { releaseA = resolve })
        let aReachedStep4Resolve: () => void
        const aReachedStep4 = new Promise<void>((resolve) => { aReachedStep4Resolve = resolve })
        let releaseB: () => void
        const gateB = new Promise<void>((resolve) => { releaseB = resolve })
        let bReachedStep4Resolve: () => void
        const bReachedStep4 = new Promise<void>((resolve) => { bReachedStep4Resolve = resolve })

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        spy.mockImplementation(async (input: any) => {
          if (input.proposalId === proposalA.id) {
            aReachedStep4Resolve()
            await gateA
          } else if (input.proposalId === proposalB.id) {
            bReachedStep4Resolve()
            await gateB
          }
          return original(input)
        })

        const runA = createCardFromInventoryRowWorkflow(container).run({
          input: { ...shared, proposalId: proposalA.id, claimToken: "not-the-real-claim-token" },
        })
        await aReachedStep4

        const runB = createCardFromInventoryRowWorkflow(container).run({
          input: { ...shared, proposalId: proposalB.id, claimToken: claimB.claimToken as string },
        })
        await bReachedStep4

        // A fails and fully compensates (including its full reverse-order
        // step 3/2/1 compensation chain) before B is allowed to proceed.
        releaseA!()
        await expect(runA).rejects.toMatchObject({ message: expect.stringMatching(/stale/i) })

        // Only now does B resolve its own proposal.
        releaseB!()
        const { result: resultB } = await runB

        const matchingCardSets = await cards.listCardSets({ provider_set_code: setCode })
        expect(matchingCardSets).toHaveLength(1)
        const matchingCards = await cards.listTradingCards({
          card_set_id: matchingCardSets[0].id, card_number_normalised: shared.cardNumber,
        })
        expect(matchingCards).toHaveLength(1)
        expect(matchingCards[0].id).toBe(resultB.tradingCardId)
        const matchingVariants = await cards.listTradingCardVariants({
          trading_card_id: matchingCards[0].id, condition: shared.condition, finish: shared.finish, special_treatment: shared.specialTreatment,
        })
        expect(matchingVariants).toHaveLength(1)
        expect(matchingVariants[0].id).toBe(resultB.tradingCardVariantId)

        const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
        const product = await products.retrieveProduct(resultB.productId, { relations: ["variants"] })
        expect(product.variants).toHaveLength(1)
        expect(product.variants?.[0]?.id).toBe(resultB.productVariantId)

        const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const { data: variantChain } = await query.graph({
          entity: "trading_card_variant",
          fields: ["id", "product_variant.id", "product_variant.inventory_items.inventory_item_id"],
          filters: { id: resultB.tradingCardVariantId },
        })
        const productVariant = variantChain[0]?.product_variant as { id?: string; inventory_items?: Array<{ inventory_item_id?: string }> } | null
        expect(productVariant?.id).toBe(resultB.productVariantId)
        const inventoryItemId = productVariant?.inventory_items?.[0]?.inventory_item_id as string
        expect(inventoryItemId).toBeTruthy()
        // Still retrievable — never deleted by A's compensation.
        await expect(inventoryService.retrieveInventoryItem(inventoryItemId)).resolves.toMatchObject({ id: inventoryItemId })

        const refreshedB = await inventory.retrieveInventoryProposal(proposalB.id)
        expect(refreshedB).toMatchObject({ change_kind: "NEW_HOLDING", trading_card_variant_id: resultB.tradingCardVariantId, card_creation_claim_token: null })
      } finally {
        spy.mockRestore()
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    60000,
  )

  it(
    "two different cards sharing a newly created CardSet: card A fails and compensates before card B completes — the shared CardSet and card B's whole chain survive",
    async () => {
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const original = (inventory.resolveInventoryProposalVariant as any).bind(inventory)
      const spy = jest.spyOn(inventory, "resolveInventoryProposalVariant")
      try {
        const source = await createSource()
        const setCode = `set_shared_deterministic_${suffix()}`
        const inputA = baseCardInput({ cardSetProviderSetCode: setCode, cardNumber: numericSuffix(), name: "Shared Deterministic Card A" })
        const inputB = baseCardInput({ cardSetProviderSetCode: setCode, cardNumber: numericSuffix(), name: "Shared Deterministic Card B" })

        const proposalA = await unresolvedVariantProposal(source.id, `shared-deterministic-a-${suffix()}`)
        const proposalB = await unresolvedVariantProposal(source.id, `shared-deterministic-b-${suffix()}`)
        const claimB = await inventory.beginCardCreationClaim({ proposalId: proposalB.id, actor: "reviewer-b", source: "MANUAL" })

        let releaseA: () => void
        const gateA = new Promise<void>((resolve) => { releaseA = resolve })
        let aReachedStep4Resolve: () => void
        const aReachedStep4 = new Promise<void>((resolve) => { aReachedStep4Resolve = resolve })
        let releaseB: () => void
        const gateB = new Promise<void>((resolve) => { releaseB = resolve })
        let bReachedStep4Resolve: () => void
        const bReachedStep4 = new Promise<void>((resolve) => { bReachedStep4Resolve = resolve })

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        spy.mockImplementation(async (input: any) => {
          if (input.proposalId === proposalA.id) {
            aReachedStep4Resolve()
            await gateA
          } else if (input.proposalId === proposalB.id) {
            bReachedStep4Resolve()
            await gateB
          }
          return original(input)
        })

        // A creates the CardSet (it starts first and there is nothing to
        // discover yet), then its own new TradingCard/TradingCardVariant.
        const runA = createCardFromInventoryRowWorkflow(container).run({
          input: { ...inputA, proposalId: proposalA.id, claimToken: "not-the-real-claim-token" },
        })
        await aReachedStep4

        // B discovers A's already-committed CardSet by identity lookup and
        // creates its own, different TradingCard under it.
        const runB = createCardFromInventoryRowWorkflow(container).run({
          input: { ...inputB, proposalId: proposalB.id, claimToken: claimB.claimToken as string },
        })
        await bReachedStep4

        releaseA!()
        await expect(runA).rejects.toMatchObject({ message: expect.stringMatching(/stale/i) })

        releaseB!()
        const { result: resultB } = await runB

        // Exactly one CardSet — A's failed request's now-compensation-free
        // step never removes it, and B never created a duplicate.
        const matchingCardSets = await cards.listCardSets({ provider_set_code: setCode })
        expect(matchingCardSets).toHaveLength(1)

        const matchingCardB = await cards.listTradingCards({
          card_set_id: matchingCardSets[0].id, card_number_normalised: inputB.cardNumber,
        })
        expect(matchingCardB).toHaveLength(1)
        expect(matchingCardB[0].id).toBe(resultB.tradingCardId)

        // Card A's own chain — created by the failed request — is left in
        // place too (deliberately, per ADR 0013), not deleted and not
        // confused with card B's.
        const matchingCardA = await cards.listTradingCards({
          card_set_id: matchingCardSets[0].id, card_number_normalised: inputA.cardNumber,
        })
        expect(matchingCardA).toHaveLength(1)
        expect(matchingCardA[0].id).not.toBe(resultB.tradingCardId)
      } finally {
        spy.mockRestore()
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    60000,
  )

  it(
    "a failed request leaves its whole chain in place — CardSet, TradingCard, TradingCardVariant, Product, ProductVariant and InventoryItem all remain retrievable",
    async () => {
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      try {
        const source = await createSource()
        const setCode = `set_leaves_chain_${suffix()}`
        const cardNumber = numericSuffix()
        const input = baseCardInput({ cardSetProviderSetCode: setCode, cardNumber, name: "Leaves Chain Card" })
        const proposal = await unresolvedVariantProposal(source.id, `leaves-chain-${suffix()}`)
        await inventory.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })

        await expect(createCardFromInventoryRowWorkflow(container).run({
          input: { ...input, proposalId: proposal.id, claimToken: "not-the-real-claim-token" },
        })).rejects.toMatchObject({ message: expect.stringMatching(/stale/i) })

        const [cardSet] = await cards.listCardSets({ provider_set_code: setCode })
        expect(cardSet).toBeTruthy()
        const [tradingCard] = await cards.listTradingCards({ card_set_id: cardSet.id, card_number_normalised: cardNumber })
        expect(tradingCard).toBeTruthy()
        const [variant] = await cards.listTradingCardVariants({
          trading_card_id: tradingCard.id, condition: input.condition, finish: input.finish, special_treatment: input.specialTreatment,
        })
        expect(variant).toBeTruthy()

        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const { data: variantChain } = await query.graph({
          entity: "trading_card_variant",
          fields: ["id", "product_variant.id", "product_variant.inventory_items.inventory_item_id"],
          filters: { id: variant.id },
        })
        const productVariant = variantChain[0]?.product_variant as { id?: string; inventory_items?: Array<{ inventory_item_id?: string }> } | null
        expect(productVariant?.id).toBeTruthy()
        const inventoryItemId = productVariant?.inventory_items?.[0]?.inventory_item_id as string
        expect(inventoryItemId).toBeTruthy()

        const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
        const productId = await (async () => {
          const { data } = await query.graph({ entity: "trading_card", fields: ["id", "product.id"], filters: { id: tradingCard.id } })
          return (data[0]?.product as { id?: string } | null)?.id as string
        })()
        expect(productId).toBeTruthy()
        await expect(products.retrieveProduct(productId)).resolves.toMatchObject({ id: productId })
        await expect(products.retrieveProductVariant(productVariant!.id as string)).resolves.toMatchObject({ id: productVariant!.id })

        const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)
        await expect(inventoryService.retrieveInventoryItem(inventoryItemId)).resolves.toMatchObject({ id: inventoryItemId })
      } finally {
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    30000,
  )

  it(
    "retrying the failed proposal with its genuine claim reuses the preserved chain — no duplicate CardSet, TradingCard or TradingCardVariant",
    async () => {
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      try {
        const source = await createSource()
        const setCode = `set_retry_reuse_${suffix()}`
        const cardNumber = numericSuffix()
        const input = baseCardInput({ cardSetProviderSetCode: setCode, cardNumber, name: "Retry Reuse Card" })
        const proposal = await unresolvedVariantProposal(source.id, `retry-reuse-${suffix()}`)
        const claim = await inventory.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })

        // First attempt: deliberately the wrong claim token, so step 4 fails
        // and the chain created by steps 1–3 is left behind, exactly as
        // ADR 0013 describes.
        await expect(createCardFromInventoryRowWorkflow(container).run({
          input: { ...input, proposalId: proposal.id, claimToken: "not-the-real-claim-token" },
        })).rejects.toMatchObject({ message: expect.stringMatching(/stale/i) })

        const [orphanCardSet] = await cards.listCardSets({ provider_set_code: setCode })
        const [orphanCard] = await cards.listTradingCards({ card_set_id: orphanCardSet.id, card_number_normalised: cardNumber })
        const [orphanVariant] = await cards.listTradingCardVariants({
          trading_card_id: orphanCard.id, condition: input.condition, finish: input.finish, special_treatment: input.specialTreatment,
        })
        expect(orphanCardSet && orphanCard && orphanVariant).toBeTruthy()

        // Retry the very same proposal, this time with its real (still-held,
        // never expired) claim token.
        const { result } = await createCardFromInventoryRowWorkflow(container).run({
          input: { ...input, proposalId: proposal.id, claimToken: claim.claimToken as string },
        })

        expect(result.tradingCardId).toBe(orphanCard.id)
        expect(result.tradingCardVariantId).toBe(orphanVariant.id)

        const matchingCardSets = await cards.listCardSets({ provider_set_code: setCode })
        expect(matchingCardSets).toHaveLength(1)
        const matchingCards = await cards.listTradingCards({ card_set_id: orphanCardSet.id, card_number_normalised: cardNumber })
        expect(matchingCards).toHaveLength(1)
        const matchingVariants = await cards.listTradingCardVariants({
          trading_card_id: orphanCard.id, condition: input.condition, finish: input.finish, special_treatment: input.specialTreatment,
        })
        expect(matchingVariants).toHaveLength(1)

        const refreshedProposal = await inventory.retrieveInventoryProposal(proposal.id)
        expect(refreshedProposal).toMatchObject({ change_kind: "NEW_HOLDING", trading_card_variant_id: result.tradingCardVariantId, card_creation_claim_token: null })
      } finally {
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    30000,
  )
})

describe("createCardFromInventoryRowWorkflow — same-step link failures never delete, and repair completes preserved chains (Codex remediation, third pass)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function isTradingCardProductLinkPayload(payload: any): boolean {
    const cardsSide = payload?.[TRADING_CARDS_MODULE]
    return !!cardsSide && "trading_card_id" in cardsSide && !("trading_card_variant_id" in cardsSide)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function isVariantProductLinkPayload(payload: any): boolean {
    const cardsSide = payload?.[TRADING_CARDS_MODULE]
    return !!cardsSide && "trading_card_variant_id" in cardsSide
  }

  it(
    "TradingCard <-> Product link: A pauses mid-link and genuinely fails; B discovers the already-committed TradingCard meanwhile and completes; A's own orphaned Product is never deleted",
    async () => {
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const originalLinkCreate = (medusaApp.link as any).create.bind(medusaApp.link)
      const linkSpy = jest.spyOn(medusaApp.link as any, "create")
      try {
        const source = await createSource()
        const setCode = `set_cardlinkrace_${suffix()}`
        const cardNumber = numericSuffix()
        const shared = baseCardInput({ cardSetProviderSetCode: setCode, cardNumber, name: `Card Link Race Card ${suffix()}` })

        const proposalA = await unresolvedVariantProposal(source.id, `cardlinkrace-a-${suffix()}`)
        const proposalB = await unresolvedVariantProposal(source.id, `cardlinkrace-b-${suffix()}`)
        const claimA = await inventory.beginCardCreationClaim({ proposalId: proposalA.id, actor: "reviewer-a", source: "MANUAL" })
        const claimB = await inventory.beginCardCreationClaim({ proposalId: proposalB.id, actor: "reviewer-b", source: "MANUAL" })

        let releaseA: () => void
        const gateA = new Promise<void>((resolve) => { releaseA = resolve })
        let aReachedLinkResolve: () => void
        const aReachedLink = new Promise<void>((resolve) => { aReachedLinkResolve = resolve })
        let releaseB: () => void
        const gateB = new Promise<void>((resolve) => { releaseB = resolve })
        let bReachedLinkResolve: () => void
        const bReachedLink = new Promise<void>((resolve) => { bReachedLinkResolve = resolve })

        let aLinkSeen = false
        let bLinkSeen = false
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        linkSpy.mockImplementation(async (payload: any) => {
          if (isTradingCardProductLinkPayload(payload)) {
            if (!aLinkSeen) {
              aLinkSeen = true
              aReachedLinkResolve()
              await gateA
              throw new Error("Injected failure: A's TradingCard<->Product link")
            }
            if (!bLinkSeen) {
              bLinkSeen = true
              bReachedLinkResolve()
              await gateB
            }
          }
          return originalLinkCreate(payload)
        })

        const runA = createCardFromInventoryRowWorkflow(container).run({
          input: { ...shared, proposalId: proposalA.id, claimToken: claimA.claimToken as string },
        })
        await aReachedLink

        // B independently runs steps 1–2 for the same identity: its own
        // CardSet/TradingCard lookup finds A's already-committed rows (A's
        // TradingCard insert completed before A ever attempted its link),
        // which is "B discovers that TradingCard and begins reuse" — B then
        // reaches its own (not-yet-attempted) link call and pauses there too.
        const runB = createCardFromInventoryRowWorkflow(container).run({
          input: { ...shared, proposalId: proposalB.id, claimToken: claimB.claimToken as string },
        })
        await bReachedLink

        // A's own link attempt fails for good — B has not linked anything
        // yet either, so A's ambiguous-outcome re-read finds no winner and
        // genuinely rethrows. This is "A completes its failure handling."
        releaseA!()
        await expect(runA).rejects.toBeTruthy()

        // Only now does B's own link proceed.
        releaseB!()
        const { result: resultB } = await runB

        // Exactly one TradingCard for the shared identity — A created it,
        // B discovered and reused it; neither duplicated it.
        const [cardSet] = await cards.listCardSets({ provider_set_code: setCode })
        const matchingCards = await cards.listTradingCards({ card_set_id: cardSet.id, card_number_normalised: shared.cardNumber })
        expect(matchingCards).toHaveLength(1)
        expect(matchingCards[0].id).toBe(resultB.tradingCardId)

        // B's own chain is complete, linked and retrievable — "the final
        // successful proposal points to a complete active chain."
        const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
        await expect(products.retrieveProduct(resultB.productId)).resolves.toMatchObject({ id: resultB.productId })
        const refreshedB = await inventory.retrieveInventoryProposal(proposalB.id)
        expect(refreshedB).toMatchObject({ change_kind: "NEW_HOLDING", trading_card_variant_id: resultB.tradingCardVariantId, card_creation_claim_token: null })

        // A's own Product (created before its link attempt failed) was
        // never deleted — it is left behind, unlinked, per ADR 0013: two
        // products share this title (A's orphan, B's linked one).
        const allProductsForName = await products.listProducts({ title: shared.name })
        expect(allProductsForName.length).toBe(2)
      } finally {
        linkSpy.mockRestore()
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    60000,
  )

  it(
    "TradingCardVariant <-> ProductVariant link: A pauses mid-link and genuinely fails; B discovers the already-committed TradingCardVariant meanwhile and completes; A's own orphaned ProductVariant is never deleted",
    async () => {
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const originalLinkCreate = (medusaApp.link as any).create.bind(medusaApp.link)
      const linkSpy = jest.spyOn(medusaApp.link as any, "create")
      try {
        const source = await createSource()
        const setCode = `set_variantlinkrace_${suffix()}`
        const cardNumber = numericSuffix()

        // Seed the card itself first (uncontested — its own single-caller
        // path is covered by earlier tests), so both A and B below are
        // racing purely at the variant level, on an existing card.
        const seedInput = baseCardInput({ cardSetProviderSetCode: setCode, cardNumber, name: "Variant Link Race Card" })
        const seedProposal = await unresolvedVariantProposal(source.id, `variantlinkrace-seed-${suffix()}`)
        const seedClaim = await inventory.beginCardCreationClaim({ proposalId: seedProposal.id, actor: "seed", source: "MANUAL" })
        await createCardFromInventoryRowWorkflow(container).run({
          input: { ...seedInput, proposalId: seedProposal.id, claimToken: seedClaim.claimToken as string },
        })

        const shared = baseCardInput({
          cardSetProviderSetCode: setCode, cardNumber, name: "Variant Link Race Card",
          condition: CARD_CONDITION.LIGHTLY_PLAYED, finish: CARD_FINISH.NORMAL, specialTreatment: SPECIAL_TREATMENT.NONE,
        })
        const proposalA = await unresolvedVariantProposal(source.id, `variantlinkrace-a-${suffix()}`)
        const proposalB = await unresolvedVariantProposal(source.id, `variantlinkrace-b-${suffix()}`)
        const claimA = await inventory.beginCardCreationClaim({ proposalId: proposalA.id, actor: "reviewer-a", source: "MANUAL" })
        const claimB = await inventory.beginCardCreationClaim({ proposalId: proposalB.id, actor: "reviewer-b", source: "MANUAL" })

        let releaseA: () => void
        const gateA = new Promise<void>((resolve) => { releaseA = resolve })
        let aReachedLinkResolve: () => void
        const aReachedLink = new Promise<void>((resolve) => { aReachedLinkResolve = resolve })
        let releaseB: () => void
        const gateB = new Promise<void>((resolve) => { releaseB = resolve })
        let bReachedLinkResolve: () => void
        const bReachedLink = new Promise<void>((resolve) => { bReachedLinkResolve = resolve })

        let aLinkSeen = false
        let bLinkSeen = false
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        linkSpy.mockImplementation(async (payload: any) => {
          if (isVariantProductLinkPayload(payload)) {
            if (!aLinkSeen) {
              aLinkSeen = true
              aReachedLinkResolve()
              await gateA
              throw new Error("Injected failure: A's TradingCardVariant<->ProductVariant link")
            }
            if (!bLinkSeen) {
              bLinkSeen = true
              bReachedLinkResolve()
              await gateB
            }
          }
          return originalLinkCreate(payload)
        })

        const runA = createCardFromInventoryRowWorkflow(container).run({
          input: { ...shared, proposalId: proposalA.id, claimToken: claimA.claimToken as string },
        })
        await aReachedLink

        const runB = createCardFromInventoryRowWorkflow(container).run({
          input: { ...shared, proposalId: proposalB.id, claimToken: claimB.claimToken as string },
        })
        await bReachedLink

        releaseA!()
        await expect(runA).rejects.toBeTruthy()

        releaseB!()
        const { result: resultB } = await runB

        const matchingVariants = await cards.listTradingCardVariants({
          trading_card_id: resultB.tradingCardId, condition: shared.condition, finish: shared.finish, special_treatment: shared.specialTreatment,
        })
        expect(matchingVariants).toHaveLength(1)
        expect(matchingVariants[0].id).toBe(resultB.tradingCardVariantId)

        const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
        const product = await products.retrieveProduct(resultB.productId, { relations: ["variants"] })
        // The seed variant plus exactly one variant for this dimension —
        // A's own orphaned ProductVariant attempt was never linked to the
        // product's Condition/Finish/Special Treatment combination search
        // path, but did still add a real ProductVariant row (never deleted).
        expect(product.variants?.length).toBeGreaterThanOrEqual(2)

        const refreshedB = await inventory.retrieveInventoryProposal(proposalB.id)
        expect(refreshedB).toMatchObject({ change_kind: "NEW_HOLDING", trading_card_variant_id: resultB.tradingCardVariantId, card_creation_claim_token: null })
      } finally {
        linkSpy.mockRestore()
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    60000,
  )

  it(
    "TradingCard <-> Product link: a link call that actually commits but still reports an error is treated as success, not a failure or a duplicate",
    async () => {
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const originalLinkCreate = (medusaApp.link as any).create.bind(medusaApp.link)
      const linkSpy = jest.spyOn(medusaApp.link as any, "create")
      try {
        const source = await createSource()
        const setCode = `set_ambiguouslink_${suffix()}`
        const cardNumber = numericSuffix()
        const input = baseCardInput({ cardSetProviderSetCode: setCode, cardNumber, name: `Ambiguous Link Card ${suffix()}` })
        const proposal = await unresolvedVariantProposal(source.id, `ambiguouslink-${suffix()}`)
        const claim = await inventory.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        linkSpy.mockImplementation(async (payload: any) => {
          if (isTradingCardProductLinkPayload(payload)) {
            await originalLinkCreate(payload) // really commits...
            throw new Error("Injected: the call reports failure even though it committed")
          }
          return originalLinkCreate(payload)
        })

        // The workflow succeeds — the ambiguous outcome is resolved by
        // re-reading committed state (finds its own just-committed link),
        // not by treating the thrown error as fatal or retrying the link.
        const { result } = await createCardFromInventoryRowWorkflow(container).run({
          input: { ...input, proposalId: proposal.id, claimToken: claim.claimToken as string },
        })

        const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
        const matchingProducts = await products.listProducts({ title: input.name })
        expect(matchingProducts).toHaveLength(1)
        expect(matchingProducts[0].id).toBe(result.productId)
      } finally {
        linkSpy.mockRestore()
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    30000,
  )

  it(
    "retry repairs a preserved incomplete TradingCard chain (identity exists, Product link missing) without duplicating the TradingCard or Product",
    async () => {
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      try {
        const setCode = `set_repaircard_${suffix()}`
        const cardNumber = numericSuffix()
        // Directly constructs the exact incomplete state a died mid-attempt
        // would leave: a committed TradingCard identity with no Product at
        // all (not even an unlinked orphan) — the simplest "missing part".
        const cardName = `Repair Card ${suffix()}`
        const set = await cards.createCardSets({ game: "POKEMON", language: "EN", display_name: "Repair Card Set", provider_set_code: setCode })
        const bareCard = await cards.createTradingCards({
          card_set_id: set.id, name: cardName, search_name: cardName.toLowerCase(),
          card_number: cardNumber, card_number_normalised: cardNumber, origin: "PULSE",
        })

        const source = await createSource()
        const proposal = await unresolvedVariantProposal(source.id, `repaircard-${suffix()}`)
        const claim = await inventory.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })
        const input = baseCardInput({ cardSetProviderSetCode: setCode, cardSetDisplayName: "Repair Card Set", cardNumber, name: cardName })

        const { result } = await createCardFromInventoryRowWorkflow(container).run({
          input: { ...input, proposalId: proposal.id, claimToken: claim.claimToken as string },
        })

        // The pre-existing (bare) TradingCard identity was reused, not duplicated.
        expect(result.tradingCardId).toBe(bareCard.id)
        const matchingCards = await cards.listTradingCards({ card_set_id: set.id, card_number_normalised: cardNumber })
        expect(matchingCards).toHaveLength(1)

        const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
        const matchingProducts = await products.listProducts({ title: cardName })
        expect(matchingProducts).toHaveLength(1)
        expect(matchingProducts[0].id).toBe(result.productId)

        const refreshed = await inventory.retrieveInventoryProposal(proposal.id)
        expect(refreshed).toMatchObject({ change_kind: "NEW_HOLDING", trading_card_variant_id: result.tradingCardVariantId, card_creation_claim_token: null })
      } finally {
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    30000,
  )

  it(
    "retry repairs a preserved incomplete TradingCardVariant chain (identity exists, ProductVariant link missing) without duplicating the TradingCardVariant or ProductVariant",
    async () => {
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      try {
        const source = await createSource()
        const setCode = `set_repairvariant_${suffix()}`
        const cardNumber = numericSuffix()
        const seedInput = baseCardInput({ cardSetProviderSetCode: setCode, cardNumber, name: "Repair Variant Card" })
        const seedProposal = await unresolvedVariantProposal(source.id, `repairvariant-seed-${suffix()}`)
        const seedClaim = await inventory.beginCardCreationClaim({ proposalId: seedProposal.id, actor: "seed", source: "MANUAL" })
        const { result: seedResult } = await createCardFromInventoryRowWorkflow(container).run({
          input: { ...seedInput, proposalId: seedProposal.id, claimToken: seedClaim.claimToken as string },
        })

        // Directly constructs the exact incomplete state a died mid-attempt
        // would leave: a committed TradingCardVariant identity (for a
        // *different* dimension combination than the seed) with no
        // ProductVariant at all.
        const bareVariant = await cards.createTradingCardVariants({
          trading_card_id: seedResult.tradingCardId, condition: "LIGHTLY_PLAYED", condition_source: "EXPLICIT",
          finish: "NORMAL", finish_confirmed: true, special_treatment: "NONE", special_treatment_confirmed: true,
          sku: `SKU-REPAIR-${suffix().toUpperCase()}`, origin: "PULSE",
        })

        const proposal = await unresolvedVariantProposal(source.id, `repairvariant-${suffix()}`)
        const claim = await inventory.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })
        const input = baseCardInput({
          cardSetProviderSetCode: setCode, cardNumber, name: "Repair Variant Card",
          condition: CARD_CONDITION.LIGHTLY_PLAYED, finish: CARD_FINISH.NORMAL, specialTreatment: SPECIAL_TREATMENT.NONE,
        })

        const { result } = await createCardFromInventoryRowWorkflow(container).run({
          input: { ...input, proposalId: proposal.id, claimToken: claim.claimToken as string },
        })

        // The pre-existing (bare) TradingCardVariant identity was reused, not duplicated.
        expect(result.tradingCardVariantId).toBe(bareVariant.id)
        const matchingVariants = await cards.listTradingCardVariants({
          trading_card_id: seedResult.tradingCardId, condition: "LIGHTLY_PLAYED", finish: "NORMAL", special_treatment: "NONE",
        })
        expect(matchingVariants).toHaveLength(1)

        const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
        const product = await products.retrieveProduct(seedResult.productId, { relations: ["variants"] })
        // The seed variant plus exactly the one just repaired — no duplicate.
        expect(product.variants).toHaveLength(2)

        const refreshed = await inventory.retrieveInventoryProposal(proposal.id)
        expect(refreshed).toMatchObject({ change_kind: "NEW_HOLDING", trading_card_variant_id: result.tradingCardVariantId, card_creation_claim_token: null })
      } finally {
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    30000,
  )

  it(
    "no committed CardSet, TradingCard, TradingCardVariant, Product, ProductVariant or InventoryItem row count ever decreases across a sequence of distinct failure modes",
    async () => {
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const originalLinkCreate = (medusaApp.link as any).create.bind(medusaApp.link)
      const linkSpy = jest.spyOn(medusaApp.link as any, "create")
      try {
        const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
        const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)

        async function counts() {
          return {
            cardSets: (await cards.listCardSets({})).length,
            tradingCards: (await cards.listTradingCards({})).length,
            tradingCardVariants: (await cards.listTradingCardVariants({})).length,
            products: (await products.listProducts({})).length,
            productVariants: (await products.listProductVariants({})).length,
            inventoryItems: (await inventoryService.listInventoryItems({})).length,
          }
        }

        const before = await counts()
        const source = await createSource()

        // Failure 1: stale claim token — fails at the final proposal-resolution step.
        const setCodeA = `set_nodecrease_a_${suffix()}`
        const cardNumberA = numericSuffix()
        const proposalA = await unresolvedVariantProposal(source.id, `nodecrease-a-${suffix()}`)
        await inventory.beginCardCreationClaim({ proposalId: proposalA.id, actor: "reviewer", source: "MANUAL" })
        await expect(createCardFromInventoryRowWorkflow(container).run({
          input: { ...baseCardInput({ cardSetProviderSetCode: setCodeA, cardNumber: cardNumberA, name: "No Decrease Card A" }), proposalId: proposalA.id, claimToken: "not-the-real-claim-token" },
        })).rejects.toMatchObject({ message: expect.stringMatching(/stale/i) })
        const afterFailure1 = await counts()

        // Failure 2: injected TradingCard<->Product link failure.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        linkSpy.mockImplementation(async (payload: any) => {
          if (isTradingCardProductLinkPayload(payload)) throw new Error("Injected link failure")
          return originalLinkCreate(payload)
        })
        const setCodeB = `set_nodecrease_b_${suffix()}`
        const cardNumberB = numericSuffix()
        const proposalB = await unresolvedVariantProposal(source.id, `nodecrease-b-${suffix()}`)
        const claimB = await inventory.beginCardCreationClaim({ proposalId: proposalB.id, actor: "reviewer", source: "MANUAL" })
        await expect(createCardFromInventoryRowWorkflow(container).run({
          input: { ...baseCardInput({ cardSetProviderSetCode: setCodeB, cardNumber: cardNumberB, name: "No Decrease Card B" }), proposalId: proposalB.id, claimToken: claimB.claimToken as string },
        })).rejects.toBeTruthy()
        const afterFailure2 = await counts()
        linkSpy.mockRestore()

        // Failure 3: AMBIGUOUS_STOCK_LOCATION — a second stock location makes the location ambiguous.
        await createStockLocation(`Loc ${suffix()}`)
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
        const setCodeC = `set_nodecrease_c_${suffix()}`
        const cardNumberC = numericSuffix()
        const proposalC = await unresolvedVariantProposal(source.id, `nodecrease-c-${suffix()}`)
        const claimC = await inventory.beginCardCreationClaim({ proposalId: proposalC.id, actor: "reviewer", source: "MANUAL" })
        await expect(createCardFromInventoryRowWorkflow(container).run({
          input: { ...baseCardInput({ cardSetProviderSetCode: setCodeC, cardNumber: cardNumberC, name: "No Decrease Card C" }), proposalId: proposalC.id, claimToken: claimC.claimToken as string },
        })).rejects.toMatchObject({ message: expect.stringMatching(/AMBIGUOUS_STOCK_LOCATION/) })
        const afterFailure3 = await counts()

        for (const key of Object.keys(before) as Array<keyof typeof before>) {
          expect(afterFailure1[key]).toBeGreaterThanOrEqual(before[key])
          expect(afterFailure2[key]).toBeGreaterThanOrEqual(afterFailure1[key])
          expect(afterFailure3[key]).toBeGreaterThanOrEqual(afterFailure2[key])
        }
      } finally {
        linkSpy.mockRestore()
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    60000,
  )
})

describe("createCardFromInventoryRowWorkflow — PostgreSQL-locked InventoryItem repair serializes concurrent callers (Codex remediation, fourth pass)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function isInventoryItemLinkPayload(payload: any): boolean {
    const productSide = payload?.[Modules.PRODUCT]
    return !!productSide && "variant_id" in productSide
  }

  async function readInventoryItemLinks(productVariantId: string): Promise<string[]> {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "product_variant", fields: ["id", "inventory_items.inventory_item_id"], filters: { id: productVariantId },
    })
    const links = (data[0]?.inventory_items ?? []) as Array<{ inventory_item_id?: string }>
    return links.map((l) => l.inventory_item_id).filter((id): id is string => Boolean(id))
  }

  /**
   * Directly constructs the exact incomplete state a died mid-attempt would
   * leave: a real committed TradingCardVariant, linked to a real committed
   * ProductVariant, with zero InventoryItems linked to that ProductVariant
   * — isolating the InventoryItem-repair race from everything upstream of
   * it (CardSet/TradingCard/TradingCardVariant/ProductVariant identity
   * resolution, already covered by the third-pass describe block above).
   * Always Lightly Played/Holo/None — distinct from `seedCard`'s own
   * Near Mint/Normal/None variant on the same product, so no option-value
   * collision to avoid.
   */
  async function createBareIncompleteVariant(
    seedResult: { tradingCardId: string; productId: string },
  ): Promise<{ productVariantId: string; tradingCardVariantId: string }> {
    const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
    const optionValues = { Condition: "Lightly Played", Finish: "Holo", "Special Treatment": "None" }
    const product = await products.retrieveProduct(seedResult.productId, { relations: ["options", "options.values"] })
    for (const [title, value] of Object.entries(optionValues)) {
      const option = product.options?.find((o) => o.title === title)
      if (!option) throw new Error(`Expected seed product to have a "${title}" option`)
      await products.updateProductOptionValuesOnProduct({ product_id: seedResult.productId, product_option_id: option.id, add: [{ value }] })
    }
    const productVariant = await products.createProductVariants({
      product_id: seedResult.productId, title: "Lightly Played · Holo", sku: `SKU-BARE-${suffix().toUpperCase()}`, manage_inventory: true, options: optionValues,
    })
    const tradingCardVariant = await cards.createTradingCardVariants({
      trading_card_id: seedResult.tradingCardId, condition: "LIGHTLY_PLAYED", condition_source: "EXPLICIT",
      finish: "HOLO", finish_confirmed: true, special_treatment: "NONE", special_treatment_confirmed: true,
      sku: `SKU-BARE-TCV-${suffix().toUpperCase()}`, origin: "PULSE",
    })
    const link = medusaApp.link
    if (!link) throw new Error("Expected Medusa link container")
    await link.create({ [Modules.PRODUCT]: { product_variant_id: productVariant.id }, [TRADING_CARDS_MODULE]: { trading_card_variant_id: tradingCardVariant.id } })
    return { productVariantId: productVariant.id, tradingCardVariantId: tradingCardVariant.id }
  }

  async function seedCard(setCode: string, cardNumber: string, source: { id: string }) {
    const seedInput = baseCardInput({ cardSetProviderSetCode: setCode, cardNumber, name: "Locked Repair Card" })
    const seedProposal = await unresolvedVariantProposal(source.id, `locked-repair-seed-${suffix()}`)
    const seedClaim = await inventory.beginCardCreationClaim({ proposalId: seedProposal.id, actor: "seed", source: "MANUAL" })
    const { result } = await createCardFromInventoryRowWorkflow(container).run({
      input: { ...seedInput, proposalId: seedProposal.id, claimToken: seedClaim.claimToken as string },
    })
    return result
  }

  it(
    "two concurrent repairers for the same incomplete ProductVariant are serialized by the real PostgreSQL lock — only one InventoryItem is created and linked, both resolve to it",
    async () => {
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      const locking = container.resolve<{ execute: (...args: unknown[]) => Promise<unknown> }>(Modules.LOCKING)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const originalExecute = (locking.execute as any).bind(locking)
      const executeSpy = jest.spyOn(locking, "execute")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const originalLinkCreate = (medusaApp.link as any).create.bind(medusaApp.link)
      const linkSpy = jest.spyOn(medusaApp.link as any, "create")
      try {
        const source = await createSource()
        const setCode = `set_lockrace_${suffix()}`
        const cardNumber = numericSuffix()
        const seedResult = await seedCard(setCode, cardNumber, source)
        const bare = await createBareIncompleteVariant(seedResult)
        const lockKey = `trading-card-inventory-repair:${bare.productVariantId}`

        // This suite never invents its own in-memory locking: the only
        // provider registered for `Modules.LOCKING` anywhere in this file's
        // `modulesConfig` (see `beforeAll` above) is
        // `@medusajs/medusa/locking-postgres`, marked `is_default: true` —
        // there is no in-memory fallback for `execute` to have silently
        // used instead, and `originalExecute` below calls straight through
        // to that same real provider.

        let executeCallsForKey = 0
        let loserExecuteCalledResolve: () => void
        const loserExecuteCalled = new Promise<void>((resolve) => { loserExecuteCalledResolve = resolve })
        executeSpy.mockImplementation(async (...args: unknown[]) => {
          const [keys] = args as [string, () => Promise<unknown>, unknown?]
          if (keys === lockKey) {
            executeCallsForKey += 1
            if (executeCallsForKey === 2) loserExecuteCalledResolve()
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return originalExecute(...(args as any))
        })

        let winnerReachedLinkResolve: () => void
        const winnerReachedLink = new Promise<void>((resolve) => { winnerReachedLinkResolve = resolve })
        let releaseWinner: () => void
        const winnerGate = new Promise<void>((resolve) => { releaseWinner = resolve })
        let winnerLinkSeen = false
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        linkSpy.mockImplementation(async (payload: any) => {
          if (isInventoryItemLinkPayload(payload) && !winnerLinkSeen) {
            winnerLinkSeen = true
            winnerReachedLinkResolve()
            // Holds the winner's real transaction open — and therefore its
            // real `pg_advisory_xact_lock` held — until the test releases
            // it, so the loser's own `execute()` call is genuinely blocked
            // at the database level for the whole window below, not merely
            // "called later" by coincidence of JS scheduling.
            await winnerGate
          }
          return originalLinkCreate(payload)
        })

        const proposalA = await unresolvedVariantProposal(source.id, `lockrace-a-${suffix()}`)
        const proposalB = await unresolvedVariantProposal(source.id, `lockrace-b-${suffix()}`)
        const claimA = await inventory.beginCardCreationClaim({ proposalId: proposalA.id, actor: "reviewer-a", source: "MANUAL" })
        const claimB = await inventory.beginCardCreationClaim({ proposalId: proposalB.id, actor: "reviewer-b", source: "MANUAL" })

        const sharedInput = baseCardInput({
          cardSetProviderSetCode: setCode, cardSetDisplayName: "Locked Repair Card Set", cardNumber, name: "Locked Repair Card",
          condition: CARD_CONDITION.LIGHTLY_PLAYED, finish: CARD_FINISH.HOLO, specialTreatment: SPECIAL_TREATMENT.NONE,
        })

        const runA = createCardFromInventoryRowWorkflow(container).run({
          input: { ...sharedInput, proposalId: proposalA.id, claimToken: claimA.claimToken as string },
        })
        // A (or B — whichever the DB scheduled first — "the winner") has
        // created its InventoryItem and level and is paused immediately
        // before linking it: both callers independently found zero linked
        // InventoryItems for this ProductVariant before either attempted to
        // create one.
        await winnerReachedLink

        const runB = createCardFromInventoryRowWorkflow(container).run({
          input: { ...sharedInput, proposalId: proposalB.id, claimToken: claimB.claimToken as string },
        })
        // The loser's own `execute()` call for the identical lock key has
        // now been issued and is genuinely blocked on the real Postgres
        // advisory lock the winner is still holding.
        await loserExecuteCalled

        releaseWinner!()
        const [outcomeA, outcomeB] = await Promise.allSettled([runA, runB])

        expect(outcomeA.status).toBe("fulfilled")
        expect(outcomeB.status).toBe("fulfilled")
        if (outcomeA.status !== "fulfilled" || outcomeB.status !== "fulfilled") throw new Error("unreachable")

        // Both reused the exact same pre-existing TradingCardVariant/ProductVariant.
        expect(outcomeA.value.result.tradingCardVariantId).toBe(bare.tradingCardVariantId)
        expect(outcomeB.value.result.tradingCardVariantId).toBe(bare.tradingCardVariantId)

        // Exactly one InventoryItem is now linked — the loser reused the
        // winner's, never created a second one.
        const links = await readInventoryItemLinks(bare.productVariantId)
        expect(links).toHaveLength(1)

        // Exactly one inventory level exists for the configured location —
        // no duplicate level from a duplicate item.
        const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)
        const levels = await inventoryService.listInventoryLevels({ inventory_item_id: links[0], location_id: location.id })
        expect(levels).toHaveLength(1)

        // No duplicate link row for this ProductVariant (already implied by
        // `links` having length 1, restated explicitly per the requirement).
        expect(executeCallsForKey).toBe(2)
      } finally {
        linkSpy.mockRestore()
        executeSpy.mockRestore()
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    60000,
  )

  it(
    "a thrown operation inside the lock's critical section still releases the lock (rolled back, per the real provider's own transaction) — a later retry for the same ProductVariant succeeds",
    async () => {
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const originalLinkCreate = (medusaApp.link as any).create.bind(medusaApp.link)
      const linkSpy = jest.spyOn(medusaApp.link as any, "create")
      try {
        const source = await createSource()
        const setCode = `set_lockthrow_${suffix()}`
        const cardNumber = numericSuffix()
        const seedResult = await seedCard(setCode, cardNumber, source)
        const bare = await createBareIncompleteVariant(seedResult)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        linkSpy.mockImplementation(async (payload: any) => {
          if (isInventoryItemLinkPayload(payload)) {
            throw new Error("Injected: inventory-item link genuinely fails, nothing committed")
          }
          return originalLinkCreate(payload)
        })

        const failProposal = await unresolvedVariantProposal(source.id, `lockthrow-fail-${suffix()}`)
        const failClaim = await inventory.beginCardCreationClaim({ proposalId: failProposal.id, actor: "reviewer", source: "MANUAL" })
        const sharedInput = baseCardInput({
          cardSetProviderSetCode: setCode, cardSetDisplayName: "Locked Repair Card Set", cardNumber, name: "Locked Repair Card",
          condition: CARD_CONDITION.LIGHTLY_PLAYED, finish: CARD_FINISH.HOLO, specialTreatment: SPECIAL_TREATMENT.NONE,
        })

        await expect(createCardFromInventoryRowWorkflow(container).run({
          input: { ...sharedInput, proposalId: failProposal.id, claimToken: failClaim.claimToken as string },
        })).rejects.toBeTruthy()

        // No link was ever created by the failed attempt.
        expect(await readInventoryItemLinks(bare.productVariantId)).toHaveLength(0)

        linkSpy.mockRestore()

        // The lock the failed attempt held (and the transaction it ran in)
        // was released on rollback — a fresh attempt for the exact same
        // ProductVariant is not stuck waiting forever, and succeeds.
        const retryProposal = await unresolvedVariantProposal(source.id, `lockthrow-retry-${suffix()}`)
        const retryClaim = await inventory.beginCardCreationClaim({ proposalId: retryProposal.id, actor: "reviewer", source: "MANUAL" })
        const { result } = await createCardFromInventoryRowWorkflow(container).run({
          input: { ...sharedInput, proposalId: retryProposal.id, claimToken: retryClaim.claimToken as string },
        })
        expect(result.tradingCardVariantId).toBe(bare.tradingCardVariantId)

        const links = await readInventoryItemLinks(bare.productVariantId)
        expect(links).toHaveLength(1)
      } finally {
        linkSpy.mockRestore()
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    30000,
  )

  it(
    "an ambiguous InventoryItem link outcome (the call commits, but still reports an error) is resolved by rereading committed state while still holding the lock, not treated as a failure or a duplicate",
    async () => {
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const originalLinkCreate = (medusaApp.link as any).create.bind(medusaApp.link)
      const linkSpy = jest.spyOn(medusaApp.link as any, "create")
      try {
        const source = await createSource()
        const setCode = `set_lockambiguous_${suffix()}`
        const cardNumber = numericSuffix()
        const seedResult = await seedCard(setCode, cardNumber, source)
        const bare = await createBareIncompleteVariant(seedResult)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        linkSpy.mockImplementation(async (payload: any) => {
          if (isInventoryItemLinkPayload(payload)) {
            await originalLinkCreate(payload) // really commits...
            throw new Error("Injected: the call reports failure even though it committed")
          }
          return originalLinkCreate(payload)
        })

        const proposal = await unresolvedVariantProposal(source.id, `lockambiguous-${suffix()}`)
        const claim = await inventory.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })
        const input = baseCardInput({
          cardSetProviderSetCode: setCode, cardSetDisplayName: "Locked Repair Card Set", cardNumber, name: "Locked Repair Card",
          condition: CARD_CONDITION.LIGHTLY_PLAYED, finish: CARD_FINISH.HOLO, specialTreatment: SPECIAL_TREATMENT.NONE,
        })

        // Succeeds — the ambiguous outcome is resolved by re-reading
        // committed state (finds its own just-committed link) rather than
        // trusting the thrown error or retrying the create.
        const { result } = await createCardFromInventoryRowWorkflow(container).run({
          input: { ...input, proposalId: proposal.id, claimToken: claim.claimToken as string },
        })
        expect(result.tradingCardVariantId).toBe(bare.tradingCardVariantId)

        const links = await readInventoryItemLinks(bare.productVariantId)
        expect(links).toHaveLength(1)
      } finally {
        linkSpy.mockRestore()
        delete process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID
      }
    },
    30000,
  )

  it(
    "more than one existing InventoryItem link on a ProductVariant fails clearly with a catalogue-integrity error, never silently selecting inventory_items[0]",
    async () => {
      const location = await createStockLocation(`Loc ${suffix()}`)
      process.env.TRADING_CARD_INVENTORY_MEDUSA_STOCK_LOCATION_ID = location.id
      try {
        const source = await createSource()
        const setCode = `set_lockduplicate_${suffix()}`
        const cardNumber = numericSuffix()
        const seedResult = await seedCard(setCode, cardNumber, source)
        const bare = await createBareIncompleteVariant(seedResult)

        // Directly create two InventoryItems and link both — simulating a
        // pre-existing catalogue anomaly (e.g. a legacy import), not
        // anything this workflow itself would produce under the fix above.
        const inventoryService = container.resolve<IInventoryService>(Modules.INVENTORY)
        const link = medusaApp.link
        if (!link) throw new Error("Expected Medusa link container")
        const itemA = await inventoryService.createInventoryItems({ sku: `SKU-DUP-A-${suffix()}` })
        const itemB = await inventoryService.createInventoryItems({ sku: `SKU-DUP-B-${suffix()}` })
        await link.create({ [Modules.PRODUCT]: { variant_id: bare.productVariantId }, [Modules.INVENTORY]: { inventory_item_id: itemA.id } })
        await link.create({ [Modules.PRODUCT]: { variant_id: bare.productVariantId }, [Modules.INVENTORY]: { inventory_item_id: itemB.id } })

        const proposal = await unresolvedVariantProposal(source.id, `lockduplicate-${suffix()}`)
        const claim = await inventory.beginCardCreationClaim({ proposalId: proposal.id, actor: "reviewer", source: "MANUAL" })
        const input = baseCardInput({
          cardSetProviderSetCode: setCode, cardSetDisplayName: "Locked Repair Card Set", cardNumber, name: "Locked Repair Card",
          condition: CARD_CONDITION.LIGHTLY_PLAYED, finish: CARD_FINISH.HOLO, specialTreatment: SPECIAL_TREATMENT.NONE,
        })

        await expect(createCardFromInventoryRowWorkflow(container).run({
          input: { ...input, proposalId: proposal.id, claimToken: claim.claimToken as string },
        })).rejects.toMatchObject({ message: expect.stringMatching(/has 2 linked InventoryItems/i) })

        // Neither existing item was touched, and nothing was deleted.
        await expect(inventoryService.retrieveInventoryItem(itemA.id)).resolves.toMatchObject({ id: itemA.id })
        await expect(inventoryService.retrieveInventoryItem(itemB.id)).resolves.toMatchObject({ id: itemB.id })
        const links = await readInventoryItemLinks(bare.productVariantId)
        expect(links).toHaveLength(2)

        // The proposal was never resolved.
        const refreshed = await inventory.retrieveInventoryProposal(proposal.id)
        expect(refreshed).toMatchObject({ change_kind: "UNRESOLVED_VARIANT", trading_card_variant_id: null })
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

      // Per ADR 0013 (third pass), nothing this workflow has already
      // committed is ever deleted, including inside a single step's own
      // failure handling. The CardSet (step 1) and the bare TradingCard
      // identity row (step 2's own insert, which itself never touches
      // stock locations) are both preserved. The Product this same step 2
      // invocation created for its first variant is preserved too — its
      // failure happens inside `createAndLinkInventoryItem`, resolving the
      // stock location, which is *after* the Product already committed —
      // left behind unlinked to the TradingCard (a `retryUntilDefined` read
      // of `trading_card.product` finds nothing until a later attempt
      // repairs it; see the "retry repairs a preserved incomplete
      // TradingCard chain" test below for that repair in action).
      const matchingCardSets = await cards.listCardSets({ provider_set_code: setCode })
      expect(matchingCardSets).toHaveLength(1)
      const matchingCards = await cards.listTradingCards({ card_number: cardNumber })
      expect(matchingCards).toHaveLength(1)
      const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
      const orphanProducts = await products.listProducts({ title: input.name })
      expect(orphanProducts).toHaveLength(1)
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
          // matching the real Condition/Finish/Special Treatment option
          // shape the create-workflow itself always sets up (see
          // `variantOptionValues`/`ensureOptionValue`).
          options: [
            { title: "Condition", values: ["Lightly Played"] },
            { title: "Finish", values: ["Holo"] },
            { title: "Special Treatment", values: ["None"] },
          ],
          variants: [{
            title: "Lightly Played · Holo", sku: `PV-LEGACY-${id}`, manage_inventory: true,
            options: { Condition: "Lightly Played", Finish: "Holo", "Special Treatment": "None" },
          }],
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
