import { randomUUID } from "node:crypto"
import type { IInventoryService, IProductModuleService, IStockLocationService, MedusaContainer } from "@medusajs/framework/types"
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
import { resolveTcgDexAdminClient } from "../../api/admin/tcgdex/dependencies"

export class CatalogueIntegrityError extends MedusaError {
  constructor(message: string) {
    super(MedusaError.Types.UNEXPECTED_STATE, message)
    this.name = "CatalogueIntegrityError"
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
  const stockLocations = container.resolve<IStockLocationService>(Modules.STOCK_LOCATION)
  const [location] = await stockLocations.listStockLocations({}, { take: 1 })
  if (!location) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "No Medusa stock location exists — create one before creating cards")
  }
  const item = await inventory.createInventoryItems({ sku })
  await inventory.createInventoryLevels([{ inventory_item_id: item.id, location_id: location.id, stocked_quantity: 0 }])
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  await link.create({ [Modules.PRODUCT]: { variant_id: productVariantId }, [Modules.INVENTORY]: { inventory_item_id: item.id } })
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
}

const resolveOrCreateCardStep = createStep(
  "resolve-or-create-trading-card",
  async (input: CreateCardFromInventoryRowInput & { cardSetId: string }, { container }) => {
    const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const numberForms = cardNumberForms(input.cardNumber)

    const [existingCard] = await cards.listTradingCards(
      { card_set_id: input.cardSetId, card_number_normalised: numberForms.normalised }, { take: 1 },
    )
    if (existingCard) {
      const { data } = await query.graph({ entity: "trading_card", fields: ["id", "product.id"], filters: { id: existingCard.id } })
      const productId = (data[0]?.product as { id?: string } | null)?.id
      if (!productId) {
        throw new CatalogueIntegrityError(
          `Trading card ${existingCard.id} has no linked Medusa product — this card's catalogue link is broken and needs manual repair.`,
        )
      }
      return new StepResponse(
        { tradingCardId: existingCard.id, productId, freshProductVariant: null as FreshProductVariant | null },
        { tradingCardId: null, productId: null, createdTradingCard: false, createdProduct: false } satisfies CardCompensation,
      )
    }

    // Brand-new card: create the Medusa Product with its first variant, then link the TradingCard to it.
    const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
    const handle = `${handleSegment(input.cardSetProviderSetCode)}-${handleSegment(numberForms.normalised)}-${shortId().toLowerCase()}`
    const variantSku = `HT-PULSE-${shortId()}`
    const optionValue = variantOptionValue({ condition: input.condition, finish: input.finish, specialTreatment: input.specialTreatment })
    const product = await products.createProducts({
      title: input.name, handle, status: "draft",
      options: [{ title: "Card Variant", values: [optionValue] }],
      variants: [{ title: optionValue, sku: variantSku, manage_inventory: true, options: { "Card Variant": optionValue } }],
    })
    const productVariantId = product.variants?.[0]?.id
    if (!productVariantId) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Product was created without its variant")
    const inventoryItemId = await createAndLinkInventoryItem(container, variantSku, productVariantId)

    const tradingCard = await cards.createTradingCards({
      card_set_id: input.cardSetId, name: input.name, search_name: input.name.toLowerCase(),
      card_number: numberForms.original, card_number_normalised: numberForms.normalised,
      rarity_raw: input.rarityRaw, rarity_comparison: input.rarityRaw == null ? null : rarityComparisonForm(input.rarityRaw),
      origin: RECORD_ORIGIN.PULSE,
    })
    const link = container.resolve(ContainerRegistrationKeys.LINK)
    await link.create({ [Modules.PRODUCT]: { product_id: product.id }, [TRADING_CARDS_MODULE]: { trading_card_id: tradingCard.id } })

    const freshProductVariant: FreshProductVariant = {
      productVariantId, inventoryItemId,
      dimensions: { condition: input.condition, finish: input.finish, specialTreatment: input.specialTreatment },
    }
    return new StepResponse(
      { tradingCardId: tradingCard.id, productId: product.id, freshProductVariant },
      { tradingCardId: tradingCard.id, productId: product.id, createdTradingCard: true, createdProduct: true } satisfies CardCompensation,
    )
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
  const { data } = await query.graph({
    entity: "trading_card_variant",
    fields: ["id", "product_variant.id", "product_variant.inventory_items.inventory_item_id"],
    filters: { id: tradingCardVariantId },
  })
  const productVariant = data[0]?.product_variant as { id?: string; inventory_items?: Array<{ inventory_item_id?: string }> | null } | null
  const inventoryItemId = productVariant?.inventory_items?.[0]?.inventory_item_id
  if (!productVariant?.id || !inventoryItemId) {
    throw new CatalogueIntegrityError(
      `Trading card variant ${tradingCardVariantId} has broken Medusa linkage (missing product variant or inventory item) — needs manual repair, not a second link.`,
    )
  }
  return { tradingCardVariantId, productVariantId: productVariant.id, inventoryItemId }
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
  "resolve-or-create-trading-card-variant",
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

    let productVariantId: string
    let inventoryItemId: string
    let createdProductVariant = false
    let createdOptionValueId: string | null = null
    let createdOptionValueOptionId: string | null = null
    const fresh = input.cardResult.freshProductVariant
    if (fresh && sameVariantDimensions(fresh.dimensions, dimensions)) {
      productVariantId = fresh.productVariantId
      inventoryItemId = fresh.inventoryItemId
    } else {
      const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
      const variantSku = `HT-PULSE-${shortId()}`
      const optionValue = variantOptionValue(dimensions)
      try {
        const { optionId, createdValueId } = await addCardVariantOptionValue(products, input.cardResult.productId, optionValue)
        createdOptionValueId = createdValueId
        createdOptionValueOptionId = createdValueId ? optionId : null
        const productVariant = await products.createProductVariants({
          product_id: input.cardResult.productId, title: optionValue,
          sku: variantSku, manage_inventory: true, options: { "Card Variant": optionValue },
        })
        productVariantId = productVariant.id
        inventoryItemId = await createAndLinkInventoryItem(container, variantSku, productVariantId)
        createdProductVariant = true
      } catch (error) {
        // Concurrent creation race: another request resolved the exact same
        // (trading_card_id, condition, finish, special_treatment) tuple
        // first — `IDX_trading_card_variant_identity` (unique) or
        // `IDX_option_value_option_id_unique` (unique) rejected our insert.
        // Best-effort clean up anything we did create before re-checking.
        if (createdOptionValueId && createdOptionValueOptionId) {
          try {
            await products.updateProductOptionValuesOnProduct({
              product_id: input.cardResult.productId, product_option_id: createdOptionValueOptionId, remove: [createdOptionValueId],
            })
          } catch {
            // best-effort only — do not mask the original error
          }
        }
        const [afterRace] = await cards.listTradingCardVariants(variantFilters, { take: 1 })
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
        throw error
      }
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
  "resolve-inventory-proposal-variant",
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
  "trigger-tcgdex-sync-best-effort",
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
