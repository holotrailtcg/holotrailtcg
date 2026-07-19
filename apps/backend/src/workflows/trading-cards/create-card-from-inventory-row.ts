import { randomUUID } from "node:crypto"
import type { IInventoryService, IProductModuleService, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"
import { cardNumberForms } from "../../modules/trading-cards/identity/card-number"
import { rarityComparisonForm } from "../../modules/trading-cards/rarity/normalise-rarity"
import { generateSku } from "../../modules/trading-cards/sku/generate-sku"
import { machineSegment } from "../../modules/trading-cards/sku/slugify"
import {
  CARD_GAME, RECORD_ORIGIN, type CardCondition, type CardFinish, type CardLanguage, type SpecialTreatment,
} from "../../modules/trading-cards/types"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import type { InventoryRecordSource } from "../../modules/trading-card-inventory/types"
import { resolveMedusaStockLocationId } from "../trading-card-inventory/medusa-inventory-sync-config"
import { resolveTcgDexAdminClient } from "../../api/admin/tcgdex/dependencies"

export class CatalogueIntegrityError extends MedusaError {
  constructor(message: string) {
    super(MedusaError.Types.UNEXPECTED_STATE, message)
    this.name = "CatalogueIntegrityError"
  }

  /**
   * The workflow engine's transaction orchestrator round-trips a failed
   * step's error through its own checkpoint/transaction-state handling
   * before `.run()` rethrows it, which does not preserve the original
   * error's prototype chain — a plain `instanceof CatalogueIntegrityError`
   * check on the error `.run()` throws is always `false`, even though the
   * error is, in every observable way, this one. `name` survives (it is set
   * as an own property in the constructor above), so this mirrors the exact
   * `instanceof X || error?.name === "X"` duck-typing pattern Medusa's own
   * step-error classes use for the same reason (see
   * `@medusajs/orchestration`'s `BaseStepErrror` subclasses).
   */
  static isCatalogueIntegrityError(error: unknown): error is CatalogueIntegrityError {
    return error instanceof CatalogueIntegrityError || (error as { name?: string })?.name === "CatalogueIntegrityError"
  }
}

/**
 * `claimToken` is minted by `beginCardCreationClaim` and must be obtained by
 * the caller (the admin route, see `create-from-inventory-row/route.ts`)
 * *before* running this workflow — not inside it. This mirrors
 * `beginMedusaSyncAttempt`/`recordMedusaSyncResult`'s existing protocol,
 * which has no in-workflow compensation step for the claim either: recovery
 * from a crashed/failed attempt happens via the claim's own lease expiry
 * (a fresh `beginCardCreationClaim` call naturally reclaims it), not via
 * saga rollback. Keeping the claim outside the workflow also avoids
 * needing conditional (`when-then`) step execution across a long chain of
 * mutually-dependent steps.
 */
export interface CreateCardFromInventoryRowInput {
  actor: string
  source: InventoryRecordSource
  proposalId: string
  claimToken: string
  cardSetProviderSetCode: string
  cardSetDisplayName: string
  cardGame: typeof CARD_GAME[keyof typeof CARD_GAME]
  cardLanguage: CardLanguage
  name: string
  cardNumber: string
  rarityRaw: string | null
  condition: CardCondition
  finish: CardFinish
  specialTreatment: SpecialTreatment
  finishConfirmed: boolean
  specialTreatmentConfirmed: boolean
}

type VariantDimensions = { condition: CardCondition; finish: CardFinish; specialTreatment: SpecialTreatment }

function sameVariantDimensions(a: VariantDimensions, b: VariantDimensions): boolean {
  return a.condition === b.condition && a.finish === b.finish && a.specialTreatment === b.specialTreatment
}

/**
 * Medusa requires every variant on one product to have a distinct value for
 * a shared option — a constant value (e.g. "Standard") for every variant
 * would collide as soon as a second condition/finish/treatment is added to
 * an existing card. This derives a human-readable, unique-per-dimension
 * option value instead.
 */
function variantOptionValue(dimensions: VariantDimensions): string {
  const parts: string[] = [dimensions.condition, dimensions.finish]
  if (dimensions.specialTreatment !== "NONE") parts.push(dimensions.specialTreatment)
  return parts.map((part) => part.replace(/_/g, " ")).join(" · ")
}

function shortId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * A single row insert (e.g. a TradingCard or TradingCardVariant) and the
 * module Link that identifies its Medusa counterpart are two separate,
 * sequentially committed statements within the winning workflow run — there
 * is a real, if brief, window in which a concurrent run's lookup can observe
 * the row but not yet the link. Retrying a few times before concluding
 * "broken linkage, needs manual repair" distinguishes that transient window
 * from genuine catalogue corruption, which persists indefinitely.
 */
async function retryUntilDefined<T>(attempt: () => Promise<T | undefined>, attempts = 5, intervalMs = 40): Promise<T | undefined> {
  for (let i = 0; i < attempts; i += 1) {
    const result = await attempt()
    if (result !== undefined) return result
    if (i < attempts - 1) await delay(intervalMs)
  }
  return undefined
}

/** URL-safe handle segment: lowercase alphanumeric and hyphens only (Medusa product handles reject underscores). */
function handleSegment(value: string): string {
  return machineSegment(value).toLowerCase().replace(/_/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "") || "x"
}

/**
 * Creates one InventoryItem and links it to a Medusa ProductVariant.
 * Explicit, never assumed automatic — Medusa's own docs are ambiguous about
 * whether `createProductsWorkflow`/`createProductVariantsWorkflow` create an
 * InventoryItem on their own, so this recipe (verified against the real
 * fixture in `medusa-inventory-sync.integration.spec.ts`) is used instead.
 */
async function createAndLinkInventoryItem(
  container: MedusaContainer, sku: string, productVariantId: string,
): Promise<string> {
  const inventory = container.resolve<IInventoryService>(Modules.INVENTORY)
  // Same Stage 5B.2 stock-location policy `syncInventoryProposalToMedusa`
  // uses — configured location first, otherwise auto-pick only when exactly
  // one exists. Never silently picks "the first" location when more than
  // one is configured; fails clearly instead, same as Stage 5B.2 does.
  const locationResolution = await resolveMedusaStockLocationId(container)
  if (locationResolution.outcome === "FAILED") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Could not resolve a Medusa stock location for the new card (${locationResolution.category}): ${locationResolution.message}`)
  }
  const locationId = locationResolution.locationId
  const item = await inventory.createInventoryItems({ sku })
  try {
    await inventory.createInventoryLevels([{ inventory_item_id: item.id, location_id: locationId, stocked_quantity: 0 }])
    const link = container.resolve(ContainerRegistrationKeys.LINK)
    await link.create({ [Modules.PRODUCT]: { variant_id: productVariantId }, [Modules.INVENTORY]: { inventory_item_id: item.id } })
  } catch (error) {
    // Self-cleaning: this function either fully succeeds (item + level +
    // link all exist) or leaves nothing behind. Callers only need to
    // compensate the InventoryItem id once it has actually been returned.
    try { await inventory.deleteInventoryItems([item.id]) } catch { /* best-effort */ }
    throw error
  }
  return item.id
}

/** Resolves a product variant's owning product id (for the hierarchy assertion). */
async function retrieveProductVariantOwner(container: MedusaContainer, productVariantId: string): Promise<string | undefined> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "product_variant", fields: ["id", "product_id"], filters: { id: productVariantId } })
  return data[0]?.product_id as string | undefined
}

// ---------------------------------------------------------------------
// Step 1: resolve-or-create CardSet
// ---------------------------------------------------------------------

interface CardSetCompensation { id: string; createdByThisRun: boolean }

const resolveOrCreateCardSetStep = createStep(
  "resolve-or-create-card-set",
  async (input: CreateCardFromInventoryRowInput, { container }) => {
    const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    const filters = { game: input.cardGame, language: input.cardLanguage, provider_set_code: input.cardSetProviderSetCode }
    const [existing] = await cards.listCardSets(filters, { take: 1 })
    if (existing) return new StepResponse({ cardSetId: existing.id }, { id: existing.id, createdByThisRun: false })
    try {
      const created = await cards.createCardSets({ ...filters, display_name: input.cardSetDisplayName })
      return new StepResponse({ cardSetId: created.id }, { id: created.id, createdByThisRun: true })
    } catch (error) {
      // Concurrent creation race: another request created the same set between our lookup and insert.
      const [afterRace] = await cards.listCardSets(filters, { take: 1 })
      if (afterRace) return new StepResponse({ cardSetId: afterRace.id }, { id: afterRace.id, createdByThisRun: false })
      throw error
    }
  },
  async (compensation: CardSetCompensation | undefined, { container }) => {
    if (!compensation?.createdByThisRun) return
    const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    await cards.deleteCardSets([compensation.id])
  },
)

// ---------------------------------------------------------------------
// Step 2: resolve-or-create TradingCard + Medusa Product (+ its first variant/item, if new)
// ---------------------------------------------------------------------

interface FreshProductVariant { productVariantId: string; inventoryItemId: string; dimensions: VariantDimensions }
interface CardCompensation {
  tradingCardId: string | null
  productId: string | null
  createdTradingCard: boolean
  createdProduct: boolean
  createdInventoryItemId: string | null
}

async function resolveProductIdForTradingCard(
  container: MedusaContainer, tradingCardId: string,
): Promise<string> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productId = await retryUntilDefined(async () => {
    const { data } = await query.graph({ entity: "trading_card", fields: ["id", "product.id"], filters: { id: tradingCardId } })
    return (data[0]?.product as { id?: string } | null)?.id
  })
  if (!productId) {
    throw new CatalogueIntegrityError(
      `Trading card ${tradingCardId} has no linked Medusa product — this card's catalogue link is broken and needs manual repair.`,
    )
  }
  return productId
}

const resolveOrCreateCardStep = createStep(
  "resolve-or-create-card",
  async (input: CreateCardFromInventoryRowInput & { cardSetId: string }, { container }) => {
    const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    const numberForms = cardNumberForms(input.cardNumber)
    const noOpCompensation: CardCompensation = {
      tradingCardId: null, productId: null, createdTradingCard: false, createdProduct: false, createdInventoryItemId: null,
    }

    const [existingCard] = await cards.listTradingCards(
      { card_set_id: input.cardSetId, card_number_normalised: numberForms.normalised }, { take: 1 },
    )
    if (existingCard) {
      const productId = await resolveProductIdForTradingCard(container, existingCard.id)
      return new StepResponse(
        { tradingCardId: existingCard.id, productId, freshProductVariant: null as FreshProductVariant | null },
        noOpCompensation,
      )
    }

    // Brand-new card: create the Medusa Product with its first variant, then
    // link the TradingCard to it — deliberately in that order. A concurrent
    // lookup above can only ever observe a *committed* TradingCard row once
    // its Product (and the link between them) already exist, so there is no
    // window in which another workflow run's lookup sees a real, fully
    // created TradingCard with a missing product and misreports it as
    // corrupted catalogue state (see `resolveProductIdForTradingCard`).
    const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
    const handle = `${handleSegment(input.cardSetProviderSetCode)}-${handleSegment(numberForms.normalised)}-${shortId().toLowerCase()}`
    const variantSku = `HT-PULSE-${shortId()}`
    const optionValue = variantOptionValue({ condition: input.condition, finish: input.finish, specialTreatment: input.specialTreatment })

    let productId: string | undefined
    let inventoryItemId: string | undefined
    let tradingCardId: string | undefined
    try {
      const product = await products.createProducts({
        title: input.name, handle, status: "draft",
        options: [{ title: "Card Variant", values: [optionValue] }],
        variants: [{ title: optionValue, sku: variantSku, manage_inventory: true, options: { "Card Variant": optionValue } }],
      })
      productId = product.id
      const productVariantId = product.variants?.[0]?.id
      if (!productVariantId) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Product was created without its variant")
      inventoryItemId = await createAndLinkInventoryItem(container, variantSku, productVariantId)

      const tradingCard = await cards.createTradingCards({
        card_set_id: input.cardSetId, name: input.name, search_name: input.name.toLowerCase(),
        card_number: numberForms.original, card_number_normalised: numberForms.normalised,
        rarity_raw: input.rarityRaw, rarity_comparison: input.rarityRaw == null ? null : rarityComparisonForm(input.rarityRaw),
        origin: RECORD_ORIGIN.PULSE,
      })
      tradingCardId = tradingCard.id
      const link = container.resolve(ContainerRegistrationKeys.LINK)
      await link.create({ [Modules.PRODUCT]: { product_id: product.id }, [TRADING_CARDS_MODULE]: { trading_card_id: tradingCard.id } })

      const freshProductVariant: FreshProductVariant = {
        productVariantId, inventoryItemId,
        dimensions: { condition: input.condition, finish: input.finish, specialTreatment: input.specialTreatment },
      }
      return new StepResponse(
        { tradingCardId: tradingCard.id, productId: product.id, freshProductVariant },
        { tradingCardId: tradingCard.id, productId: product.id, createdTradingCard: true, createdProduct: true, createdInventoryItemId: inventoryItemId } satisfies CardCompensation,
      )
    } catch (error) {
      // This step is about to throw without returning a StepResponse, so the
      // orchestrator will never learn what was created above and will never
      // call this step's own compensation for it. Clean up everything we
      // created ourselves before deciding whether this was a recoverable
      // concurrent-creation race (lost at the TradingCard insert's unique
      // constraint) or a genuine failure to rethrow.
      if (tradingCardId) {
        try { await cards.deleteTradingCards([tradingCardId]) } catch { /* best-effort */ }
      }
      if (productId) {
        try { await products.deleteProducts([productId]) } catch { /* best-effort */ }
      }
      if (inventoryItemId) {
        const inventory = container.resolve<IInventoryService>(Modules.INVENTORY)
        try { await inventory.deleteInventoryItems([inventoryItemId]) } catch { /* best-effort */ }
      }
      // Only the TradingCard insert itself carries a race-breaking unique
      // constraint (`IDX_trading_card_identity`) — if we got far enough to
      // create our own tradingCardId, we already won any such race, so a
      // later failure (e.g. the link) is a genuine failure, not a race.
      if (!tradingCardId) {
        const [afterRace] = await cards.listTradingCards(
          { card_set_id: input.cardSetId, card_number_normalised: numberForms.normalised }, { take: 1 },
        )
        if (afterRace) {
          const winnerProductId = await resolveProductIdForTradingCard(container, afterRace.id)
          return new StepResponse(
            { tradingCardId: afterRace.id, productId: winnerProductId, freshProductVariant: null as FreshProductVariant | null },
            noOpCompensation,
          )
        }
      }
      throw error
    }
  },
  async (compensation: CardCompensation | undefined, { container }) => {
    if (!compensation) return
    if (compensation.createdTradingCard && compensation.tradingCardId) {
      const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
      await cards.deleteTradingCards([compensation.tradingCardId])
    }
    if (compensation.createdProduct && compensation.productId) {
      const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
      await products.deleteProducts([compensation.productId])
    }
    if (compensation.createdInventoryItemId) {
      const inventory = container.resolve<IInventoryService>(Modules.INVENTORY)
      await inventory.deleteInventoryItems([compensation.createdInventoryItemId])
    }
  },
)

// ---------------------------------------------------------------------
// Step 3: resolve-or-create TradingCardVariant + ProductVariant + InventoryItem
// ---------------------------------------------------------------------

interface CardStepResult { tradingCardId: string; productId: string; freshProductVariant: FreshProductVariant | null }
interface VariantCompensation {
  tradingCardVariantId: string | null
  productVariantId: string | null
  createdOptionValueId: string | null
  createdOptionValueOptionId: string | null
  createdTradingCardVariant: boolean
  createdProductVariant: boolean
}

/**
 * Resolves the full linked chain (ProductVariant + InventoryItem) for an
 * already-existing TradingCardVariant, or throws a `CatalogueIntegrityError`
 * if either link is broken. Shared by the fast lookup path and the
 * lose-the-creation-race path below (§ concurrency).
 */
async function resolveExistingVariantChain(container: MedusaContainer, tradingCardVariantId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const chain = await retryUntilDefined(async () => {
    const { data } = await query.graph({
      entity: "trading_card_variant",
      fields: ["id", "product_variant.id", "product_variant.inventory_items.inventory_item_id"],
      filters: { id: tradingCardVariantId },
    })
    const productVariant = data[0]?.product_variant as { id?: string; inventory_items?: Array<{ inventory_item_id?: string }> | null } | null
    const inventoryItemId = productVariant?.inventory_items?.[0]?.inventory_item_id
    if (!productVariant?.id || !inventoryItemId) return undefined
    return { tradingCardVariantId, productVariantId: productVariant.id, inventoryItemId }
  })
  if (!chain) {
    throw new CatalogueIntegrityError(
      `Trading card variant ${tradingCardVariantId} has broken Medusa linkage (missing product variant or inventory item) — needs manual repair, not a second link.`,
    )
  }
  return chain
}

/**
 * Adds a new value to the product's "Card Variant" option, reusing the
 * official Medusa module-service APIs (`updateProductOptionValuesOnProduct`
 * / `updateProducts`) rather than raw SQL. Verified against this Medusa
 * version's own source (`product-module-service.js`): both calls run
 * through the module's own transactionManager/event pipeline, correctly
 * populate the `product_product_option` / `product_product_option_value`
 * pivot rows (Medusa 2.16+ shared-option-entity schema), and are idempotent
 * — `updateProductOptionValuesOnProduct` skips creating a value whose name
 * already exists on the option, and skips re-linking a pivot that already
 * exists. Returns the created value's id (for compensation) or `null` if
 * the value already existed (nothing to compensate).
 */
async function addCardVariantOptionValue(
  products: IProductModuleService, productId: string, optionValue: string,
): Promise<{ optionId: string; createdValueId: string | null }> {
  const productWithOptions = await products.retrieveProduct(productId, { relations: ["options", "options.values"] })
  const cardVariantOption = productWithOptions.options?.find((option) => option.title === "Card Variant")

  // Every product this workflow creates already has a "Card Variant" option
  // (§ step 2) — this can only be missing on a legacy/manually-repaired
  // product. Fail clearly rather than fabricating a new option under a
  // different id, which would produce an ambiguous second option on the
  // product (see CatalogueIntegrityError usage elsewhere in this file).
  if (!cardVariantOption) {
    throw new CatalogueIntegrityError(
      `Product ${productId} has no "Card Variant" option — its catalogue linkage is damaged and needs manual repair before another variant can be added.`,
    )
  }

  const alreadyPresent = cardVariantOption.values?.some((value) => value.value === optionValue)
  if (!alreadyPresent) {
    await products.updateProductOptionValuesOnProduct({
      product_id: productId, product_option_id: cardVariantOption.id, add: [{ value: optionValue }],
    })
  }
  const refreshed = await products.retrieveProduct(productId, { relations: ["options", "options.values"] })
  const refreshedOption = refreshed.options?.find((option) => option.id === cardVariantOption.id)
  const valueRow = refreshedOption?.values?.find((value) => value.value === optionValue)
  return { optionId: cardVariantOption.id, createdValueId: alreadyPresent ? null : (valueRow?.id ?? null) }
}

const resolveOrCreateVariantStep = createStep(
  "resolve-or-create-variant",
  async (input: CreateCardFromInventoryRowInput & { cardResult: CardStepResult }, { container }) => {
    const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    const dimensions: VariantDimensions = { condition: input.condition, finish: input.finish, specialTreatment: input.specialTreatment }
    const variantFilters = {
      trading_card_id: input.cardResult.tradingCardId, condition: dimensions.condition,
      finish: dimensions.finish, special_treatment: dimensions.specialTreatment,
    }

    const [existingVariant] = await cards.listTradingCardVariants(variantFilters, { take: 1 })
    if (existingVariant) {
      const chain = await resolveExistingVariantChain(container, existingVariant.id)
      return new StepResponse(
        chain,
        {
          tradingCardVariantId: null, productVariantId: null, createdOptionValueId: null, createdOptionValueOptionId: null,
          createdTradingCardVariant: false, createdProductVariant: false,
        } satisfies VariantCompensation,
      )
    }

    const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
    let productVariantId: string
    let inventoryItemId: string
    let createdProductVariant = false
    let createdOptionValueId: string | null = null
    let createdOptionValueOptionId: string | null = null
    let createdTradingCardVariantId: string | undefined

    // Everything below is one compensatable unit: whichever of these
    // sub-operations throws, the orchestrator will never see a StepResponse
    // for this step and so will never learn what needs cleaning up. The
    // catch block below cleans up in reverse creation order and — only when
    // our own TradingCardVariant insert never got far enough to succeed
    // (the point `IDX_trading_card_variant_identity` actually enforces
    // uniqueness) — re-checks for a concurrent-race winner before rethrowing.
    try {
      const fresh = input.cardResult.freshProductVariant
      if (fresh && sameVariantDimensions(fresh.dimensions, dimensions)) {
        productVariantId = fresh.productVariantId
        inventoryItemId = fresh.inventoryItemId
      } else {
        const variantSku = `HT-PULSE-${shortId()}`
        const optionValue = variantOptionValue(dimensions)
        const { optionId, createdValueId } = await addCardVariantOptionValue(products, input.cardResult.productId, optionValue)
        createdOptionValueId = createdValueId
        createdOptionValueOptionId = createdValueId ? optionId : null

        // `createProductVariants` re-resolves the product's own option
        // values from scratch rather than trusting the row `addCardVariant
        // OptionValue` just confirmed present. Under two concurrent callers
        // adding the exact same *new* option value, Medusa's own add/reconcile
        // path is not safe against the interleaving: one caller's freshly
        // committed value can be momentarily invisible to the other's variant
        // creation, or can even be recreated under a different id part-way
        // through. Bounded retry — re-confirming (and, if needed, re-adding;
        // `addCardVariantOptionValue` is itself idempotent) the value each
        // time and using whatever id it reports *right now* — rides out that
        // window instead of surfacing a spurious failure.
        let productVariant: Awaited<ReturnType<typeof products.createProductVariants>>
        let attempt = 0
        for (;;) {
          try {
            productVariant = await products.createProductVariants({
              product_id: input.cardResult.productId, title: optionValue,
              sku: variantSku, manage_inventory: true, options: { "Card Variant": optionValue },
            })
            break
          } catch (variantError) {
            attempt += 1
            const message = variantError instanceof Error ? variantError.message : String(variantError)
            if (attempt >= 5 || !/does not exist/i.test(message)) throw variantError
            await delay(60)
            const retried = await addCardVariantOptionValue(products, input.cardResult.productId, optionValue)
            createdOptionValueId = retried.createdValueId
            createdOptionValueOptionId = retried.createdValueId ? retried.optionId : null
          }
        }
        productVariantId = productVariant.id
        inventoryItemId = await createAndLinkInventoryItem(container, variantSku, productVariantId)
        createdProductVariant = true
      }

      const ownerProductId = await retrieveProductVariantOwner(container, productVariantId)
      await cards.assertVariantProductHierarchy({ productVariantProductId: ownerProductId, tradingCardProductId: input.cardResult.productId })

      const sku = generateSku({
        tradingCardId: input.cardResult.tradingCardId, game: input.cardGame, language: input.cardLanguage,
        setCode: input.cardSetProviderSetCode, cardNumber: input.cardNumber, cardName: input.name,
        condition: input.condition, finish: input.finish, specialTreatment: input.specialTreatment,
      })
      const tradingCardVariant = await cards.createTradingCardVariants({
        trading_card_id: input.cardResult.tradingCardId, condition: input.condition, condition_source: "EXPLICIT",
        finish: input.finish, finish_confirmed: input.finishConfirmed,
        special_treatment: input.specialTreatment, special_treatment_confirmed: input.specialTreatmentConfirmed,
        sku, origin: RECORD_ORIGIN.PULSE,
      })
      createdTradingCardVariantId = tradingCardVariant.id
      const link = container.resolve(ContainerRegistrationKeys.LINK)
      await link.create({ [Modules.PRODUCT]: { product_variant_id: productVariantId }, [TRADING_CARDS_MODULE]: { trading_card_variant_id: tradingCardVariant.id } })

      return new StepResponse(
        { tradingCardVariantId: tradingCardVariant.id, productVariantId, inventoryItemId },
        {
          tradingCardVariantId: tradingCardVariant.id, productVariantId: createdProductVariant ? productVariantId : null,
          createdOptionValueId, createdOptionValueOptionId,
          createdTradingCardVariant: true, createdProductVariant,
        } satisfies VariantCompensation,
      )
    } catch (error) {
      if (createdTradingCardVariantId) {
        try { await cards.deleteTradingCardVariants([createdTradingCardVariantId]) } catch { /* best-effort */ }
      }
      // Deliberately not cleaning up createdOptionValueId/createdOptionValueOptionId
      // here. `addCardVariantOptionValue`'s "already present?" check has an
      // inherent TOCTOU race under two concurrent callers adding the exact
      // same *new* option value: both can observe "not present" and both
      // track the resulting id as their own creation, even though only one
      // value actually gets persisted. Removing it here — before we know
      // whether we won or lost the identity race below — risks deleting a
      // value the *other* caller is still actively using for its own
      // in-flight (or already-committed) ProductVariant. A stray unused
      // option value left on the product is harmless (see the top-level
      // compensation function below, which only ever removes a value it
      // confirmed was exclusively its own successful creation).
      if (createdProductVariant) {
        // Only ours to clean up when this step itself created a *new*
        // ProductVariant/InventoryItem — never the `fresh` pair handed down
        // from step 2, whose cleanup remains step 2's own compensation.
        try { await products.deleteProductVariants([productVariantId!]) } catch { /* best-effort */ }
        const inventory = container.resolve<IInventoryService>(Modules.INVENTORY)
        try { await inventory.deleteInventoryItems([inventoryItemId!]) } catch { /* best-effort */ }
      }
      // Concurrent creation race: another request resolved the exact same
      // (trading_card_id, condition, finish, special_treatment) tuple first.
      // Only meaningful to re-check once our own createTradingCardVariants
      // call never succeeded — if it did, we already won any such race. The
      // winner's ProductVariant can fail us out here (e.g. Medusa's own
      // "variant with these options already exists" check) *before* the
      // winner has itself reached its own createTradingCardVariants call —
      // retry the lookup rather than giving up on the very first miss.
      if (!createdTradingCardVariantId) {
        const afterRace = await retryUntilDefined(async () => {
          const [found] = await cards.listTradingCardVariants(variantFilters, { take: 1 })
          return found
        })
        if (afterRace) {
          const chain = await resolveExistingVariantChain(container, afterRace.id)
          return new StepResponse(
            chain,
            {
              tradingCardVariantId: null, productVariantId: null, createdOptionValueId: null, createdOptionValueOptionId: null,
              createdTradingCardVariant: false, createdProductVariant: false,
            } satisfies VariantCompensation,
          )
        }
      }
      throw error
    }
  },
  async (compensation: VariantCompensation | undefined, { container }) => {
    if (!compensation) return
    if (compensation.createdTradingCardVariant && compensation.tradingCardVariantId) {
      const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
      await cards.deleteTradingCardVariants([compensation.tradingCardVariantId])
    }
    if (compensation.createdProductVariant && compensation.productVariantId) {
      const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
      await products.deleteProductVariants([compensation.productVariantId])
    }
    if (compensation.createdOptionValueId && compensation.createdOptionValueOptionId) {
      const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
      try {
        await products.deleteProductOptionValues([compensation.createdOptionValueId])
      } catch {
        // best-effort — an unused option value left behind is not a broken link
      }
    }
  },
)

// ---------------------------------------------------------------------
// Step 4: resolve the originating inventory proposal (atomic, claim-guarded)
// ---------------------------------------------------------------------

const resolveProposalStep = createStep(
  "resolve-proposal",
  async (input: { actor: string; source: InventoryRecordSource; proposalId: string; claimToken: string; tradingCardVariantId: string }, { container }) => {
    const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
    const result = await inventory.resolveInventoryProposalVariant({
      actor: input.actor, source: input.source, proposalId: input.proposalId,
      claimToken: input.claimToken, tradingCardVariantId: input.tradingCardVariantId,
    })
    return new StepResponse(result)
  },
)

// ---------------------------------------------------------------------
// Step 5: TCGdex trigger — best-effort, never throws, runs only after step 4 commits
// ---------------------------------------------------------------------

export type TcgdexEnrichmentStatus = "TRIGGERED" | "FAILED_TO_TRIGGER"

const triggerTcgdexSyncStep = createStep(
  "trigger-tcgdex-sync",
  async (input: { actor: string; tradingCardId: string }, { container }): Promise<StepResponse<TcgdexEnrichmentStatus>> => {
    try {
      const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
      const client = resolveTcgDexAdminClient(container)
      await cards.retryTcgdexEnrichmentMatch({ actor: input.actor, source: "TCGDEX", tradingCardId: input.tradingCardId, client })
      return new StepResponse("TRIGGERED")
    } catch {
      return new StepResponse("FAILED_TO_TRIGGER")
    }
  },
)

// ---------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------

export interface CreateCardFromInventoryRowResult {
  tradingCardId: string
  tradingCardVariantId: string
  productId: string
  productVariantId: string
  tcgdexEnrichmentStatus: TcgdexEnrichmentStatus
}

export const createCardFromInventoryRowWorkflow = createWorkflow(
  "create-card-from-inventory-row",
  (input: CreateCardFromInventoryRowInput) => {
    const cardSet = resolveOrCreateCardSetStep(input)
    const cardStepInput = transform({ input, cardSet }, ({ input, cardSet }) => ({ ...input, cardSetId: cardSet.cardSetId }))
    const cardResult = resolveOrCreateCardStep(cardStepInput)
    const variantStepInput = transform({ input, cardResult }, ({ input, cardResult }) => ({ ...input, cardResult }))
    const variantResult = resolveOrCreateVariantStep(variantStepInput)
    resolveProposalStep({
      actor: input.actor, source: input.source, proposalId: input.proposalId,
      claimToken: input.claimToken, tradingCardVariantId: variantResult.tradingCardVariantId,
    })
    const tcgdexEnrichmentStatus = triggerTcgdexSyncStep({ actor: input.actor, tradingCardId: cardResult.tradingCardId })

    return new WorkflowResponse({
      tradingCardId: cardResult.tradingCardId, tradingCardVariantId: variantResult.tradingCardVariantId,
      productId: cardResult.productId, productVariantId: variantResult.productVariantId,
      tcgdexEnrichmentStatus,
    })
  },
)
