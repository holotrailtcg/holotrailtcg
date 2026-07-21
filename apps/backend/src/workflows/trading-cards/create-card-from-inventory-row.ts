import { randomUUID } from "node:crypto"
import type { ILockingModule, IInventoryService, IProductModuleService, MedusaContainer } from "@medusajs/framework/types"
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
  /** E2B: the linked Medusa Product Category id for the reviewer-confirmed eBay Store category, if one was assigned. Applied only when a new Product is actually created — see `ensureProductChainForTradingCard`. */
  categoryId?: string | null
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
 * Codex remediation (third pass) — the governing invariant for this whole
 * file:
 *
 *   Once a CardSet, TradingCard, TradingCardVariant, Product,
 *   ProductVariant or InventoryItem has been committed, this workflow must
 *   never synchronously delete it.
 *
 * The first two remediation passes fixed this for cross-step *compensation*
 * (steps 1–3 register no compensation callback — see `createStep` calls
 * below) but left the same defect inside each step's own same-invocation
 * `catch` block: on a later sub-operation's failure (almost always the
 * final module-link call), those blocks deleted the TradingCard/Product/
 * InventoryItem (step 2) or TradingCardVariant/ProductVariant/InventoryItem
 * (step 3) *this very call* had just committed — which is exactly as
 * discoverable, by the same identity lookup every step performs, as
 * anything cross-step compensation could reach. A concurrent request's
 * lookup can observe a row the instant it commits, independent of which
 * function (a compensation callback or an inline `catch`) would eventually
 * try to delete it — the invariant does not distinguish between them, and
 * neither should this file.
 *
 * So no code path in this file deletes a committed CardSet, TradingCard,
 * TradingCardVariant, Product, ProductVariant or InventoryItem, ever. A
 * step that fails partway through preserves everything it already
 * committed. This means every step's job is really two separable
 * questions, both idempotent and re-run safe:
 *
 *   1. Does the identity (CardSet / TradingCard / TradingCardVariant) exist?
 *      If not, create it — its own database unique constraint
 *      (`IDX_trading_card_identity`, `IDX_trading_card_variant_identity`) is
 *      what breaks a concurrent creation race, exactly as it always has.
 *   2. Is that identity's Medusa-side chain (Product/ProductVariant/
 *      InventoryItem + module links) complete? If not — whether because
 *      this is a brand-new identity or because a previous attempt committed
 *      the identity but died before finishing its chain — create or
 *      restore only whatever part is missing, then link it. `ensureProduct
 *      ChainForTradingCard` (step 2) and `ensureVariantProductChain`
 *      (step 3) below are that repair logic: they always re-read the
 *      actual committed state before deciding anything is missing (an
 *      "ambiguous" link outcome — the call threw, but may have committed
 *      anyway, or a concurrent repairer may have finished first — is
 *      resolved by trusting that re-read over the thrown error), and they
 *      only ever create-or-reuse, never delete. The 1:1 module links this
 *      file creates (`trading_card` ↔ `product`, `trading_card_variant` ↔
 *      `product_variant`) themselves reject a second link for an identity
 *      that already has one, which is what makes "attempt the link, and on
 *      failure re-read who actually won" race-safe without a cross-step
 *      transaction — the same pattern this file already used for the
 *      identity rows themselves.
 *
 * This preserves both the identity and its dependents, so a retry of the
 * same failed request — or a concurrent, unrelated request for the same
 * card — always finds and repairs (never duplicates) whatever the previous
 * attempt left behind. `CatalogueIntegrityError` is now reserved for state
 * this repair logic cannot safely reconcile on its own (e.g. a
 * ProductVariant that legitimately belongs to a different Product than its
 * TradingCard — see `assertVariantProductHierarchy`, or a Product missing
 * the "Card Variant" option entirely — see `addCardVariantOptionValue`),
 * not for an ordinary missing link, which this file now repairs instead.
 *
 * The only accepted residual: a same-invocation retry can leave behind a
 * harmless, unlinked orphan (e.g. an InventoryItem whose level/link call
 * failed, or a losing race's Product/ProductVariant) — see the "Deferred:
 * orphan reconciliation" section of ADR 0013. That is a tidiness concern,
 * never a correctness or data-loss one: nothing this file ever creates is
 * discoverable by its own identity lookups until it is actually linked, so
 * an orphan like this can never be the thing a concurrent request depends
 * on.
 */

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
 *
 * Only ever called from inside `ensureSingleInventoryItemForProductVariant`'s
 * locked critical section below — never directly by a step.
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
  // No cleanup on failure below — see the invariant note above `delay()`.
  // Once created, this InventoryItem is never deleted, even if its level or
  // its link to `productVariantId` never commits. It has no identity a
  // later retry can look it up by (its `sku` is a random, disposable
  // value), so a retry simply creates another one via a fresh call to this
  // same function; the earlier attempt is left behind as a harmless,
  // unlinked, deferred-reconciliation orphan (see ADR 0013) rather than
  // risking a delete racing a concurrent request that has already linked it
  // and started depending on it.
  await inventory.createInventoryLevels([{ inventory_item_id: item.id, location_id: locationId, stocked_quantity: 0 }])
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  await link.create({ [Modules.PRODUCT]: { variant_id: productVariantId }, [Modules.INVENTORY]: { inventory_item_id: item.id } })
  return item.id
}

/**
 * Reads a ProductVariant's *currently linked* InventoryItem ids directly, as
 * a full list — never `inventory_items[0]`. Medusa's `product_variant` ↔
 * `inventory_item` link is `isList: true` on both sides (it exists to
 * support inventory kits: one variant can genuinely have several inventory
 * items, and one item can serve several variants), so there is no built-in
 * constraint making "the first one" a safe stand-in for "the only one".
 * Holo Trail's own narrower invariant — exactly one InventoryItem per
 * trading-card ProductVariant — is enforced by
 * `ensureSingleInventoryItemForProductVariant` below, not assumed here.
 */
async function readInventoryItemLinksForProductVariant(
  container: MedusaContainer, productVariantId: string,
): Promise<string[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_variant", fields: ["id", "inventory_items.inventory_item_id"], filters: { id: productVariantId },
  })
  const links = (data[0]?.inventory_items ?? []) as Array<{ inventory_item_id?: string }>
  return links.map((link) => link.inventory_item_id).filter((id): id is string => Boolean(id))
}

/** Creates a stock level for `inventoryItemId` at the configured location, only if one doesn't already exist there — repairs a level without touching an otherwise-intact InventoryItem/link. */
async function ensureInventoryLevelForItem(container: MedusaContainer, inventoryItemId: string): Promise<void> {
  const locationResolution = await resolveMedusaStockLocationId(container)
  if (locationResolution.outcome === "FAILED") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Could not resolve a Medusa stock location to repair inventory item ${inventoryItemId} (${locationResolution.category}): ${locationResolution.message}`)
  }
  const inventory = container.resolve<IInventoryService>(Modules.INVENTORY)
  const existingLevels = await inventory.listInventoryLevels({ inventory_item_id: inventoryItemId, location_id: locationResolution.locationId })
  if (existingLevels.length > 0) return
  await inventory.createInventoryLevels([{ inventory_item_id: inventoryItemId, location_id: locationResolution.locationId, stocked_quantity: 0 }])
}

/**
 * The single, PostgreSQL-lock-serialized path every step in this file goes
 * through to get "the one InventoryItem" for a ProductVariant — whether the
 * variant is brand new (no links yet, needs creating), reused from an
 * earlier complete attempt (exactly one link, only its stock level might
 * need repairing), or reused from an earlier incomplete attempt (a
 * previously created ProductVariant whose InventoryItem step never
 * finished).
 *
 * Without a lock, two concurrent repairers for the *same* productVariantId
 * (e.g. two different Pulse rows resolving to the same existing card
 * variant at once) could both read "no links yet" before either commits,
 * and both create and link their own InventoryItem — the exact duplicate
 * Holo Trail's one-InventoryItem-per-variant invariant must prevent. A
 * process-local mutex cannot close this window (a second server instance,
 * or worker process, would not see it); only a lock backed by the shared
 * database can serialize callers across every process sharing it. See
 * ADR 0013 and the Stage 5B.3 operations guide for the full rationale,
 * the lock key convention, and cross-instance behaviour.
 *
 * The lock itself is acquired and released by the Locking Module's own
 * `execute` — it acquires the lock before running the callback and always
 * releases it afterwards, including when the callback throws (see
 * `@medusajs/locking-postgres`'s `PostgresAdvisoryLockProvider.execute`,
 * which runs the callback inside a `pg_advisory_xact_lock`-guarded
 * transaction and releases via that transaction's own commit/rollback).
 * Everything inside the callback re-reads committed state — nothing read
 * *before* this call (e.g. an earlier bounded/optimistic check elsewhere in
 * this file) is trusted once the lock is held.
 */
async function ensureSingleInventoryItemForProductVariant(
  container: MedusaContainer, productVariantId: string, skuForNewItem: string,
): Promise<string> {
  const locking = container.resolve<ILockingModule>(Modules.LOCKING)
  const lockKey = `trading-card-inventory-repair:${productVariantId}`

  return locking.execute(lockKey, async () => {
    const existingLinks = await readInventoryItemLinksForProductVariant(container, productVariantId)

    if (existingLinks.length > 1) {
      throw new CatalogueIntegrityError(
        `Product variant ${productVariantId} has ${existingLinks.length} linked InventoryItems — Holo Trail expects exactly one for a trading-card variant. Refusing to guess which is authoritative; this needs manual repair.`,
      )
    }

    if (existingLinks.length === 1) {
      const inventoryItemId = existingLinks[0]
      await ensureInventoryLevelForItem(container, inventoryItemId)
      return inventoryItemId
    }

    // Genuinely missing — create and link one. An ambiguous outcome (the
    // call threw but may have actually committed) is resolved the same way
    // as every other link attempt in this file: re-read committed state
    // — still holding the lock, so no concurrent repairer could have raced
    // us here — rather than trusting the thrown error.
    try {
      return await createAndLinkInventoryItem(container, skuForNewItem, productVariantId)
    } catch (error) {
      const afterError = await readInventoryItemLinksForProductVariant(container, productVariantId)
      if (afterError.length === 1) return afterError[0]
      if (afterError.length > 1) {
        throw new CatalogueIntegrityError(
          `Product variant ${productVariantId} unexpectedly has ${afterError.length} linked InventoryItems after a failed create attempt — needs manual repair.`,
        )
      }
      throw error
    }
  })
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

const resolveOrCreateCardSetStep = createStep(
  "resolve-or-create-card-set",
  async (input: CreateCardFromInventoryRowInput, { container }) => {
    const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    const filters = { game: input.cardGame, language: input.cardLanguage, provider_set_code: input.cardSetProviderSetCode }
    const [existing] = await cards.listCardSets(filters, { take: 1 })
    if (existing) return new StepResponse({ cardSetId: existing.id })
    try {
      const created = await cards.createCardSets({ ...filters, display_name: input.cardSetDisplayName })
      return new StepResponse({ cardSetId: created.id })
    } catch (error) {
      // Concurrent creation race: another request created the same set between our lookup and insert.
      const [afterRace] = await cards.listCardSets(filters, { take: 1 })
      if (afterRace) return new StepResponse({ cardSetId: afterRace.id })
      throw error
    }
  },
  // No compensation — see the remediation note above `delay()`. A CardSet
  // this step creates is left in place on a later step's failure.
)

// ---------------------------------------------------------------------
// Step 2: resolve-or-create TradingCard + Medusa Product (+ its first variant/item, if new)
// ---------------------------------------------------------------------

interface FreshProductVariant { productVariantId: string; dimensions: VariantDimensions }

/** Single, no-retry read of a TradingCard's currently-linked Medusa product id, or `undefined` if none exists right now. */
async function readTradingCardProductId(container: MedusaContainer, tradingCardId: string): Promise<string | undefined> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "trading_card", fields: ["id", "product.id"], filters: { id: tradingCardId } })
  return (data[0]?.product as { id?: string } | null)?.id
}

/**
 * Ensures `tradingCardId` has a complete, linked Medusa Product (+ first
 * ProductVariant + InventoryItem, if the product itself has to be created).
 * Never deletes anything — see the invariant note above `delay()`. Handles
 * three cases, all idempotent and safe to re-run:
 *
 *   1. The product already exists (the common case, and also what a retry
 *      of a *complete* prior attempt sees) — a bounded re-read (the same
 *      transient-commit-visibility window `retryUntilDefined` exists for
 *      elsewhere in this file) is enough, no creation needed.
 *   2. Nothing was ever created for this TradingCard (brand new, or a
 *      previous attempt died before creating anything) — create the
 *      Product/variant/item and link it.
 *   3. A previous attempt created the Product/variant/item but the final
 *      link never committed (or its outcome is ambiguous — the call threw,
 *      but may have committed anyway) — the link's own 1:1 constraint
 *      (`trading_card` ↔ `product`) rejects a second link for a
 *      TradingCard that already has one, so attempting our own link and,
 *      on failure, re-reading who actually holds it now is race-safe
 *      without needing a cross-step transaction. If a concurrent repairer
 *      already won, our own freshly created Product/variant/item are left
 *      behind, unlinked (see ADR 0013's deferred orphan reconciliation) —
 *      never deleted, and never reused as anyone's product, since nothing
 *      ever came to point at them.
 */
async function ensureProductChainForTradingCard(
  container: MedusaContainer, input: CreateCardFromInventoryRowInput, tradingCardId: string,
): Promise<{ productId: string; freshProductVariant: FreshProductVariant | null }> {
  const existingProductId = await retryUntilDefined(() => readTradingCardProductId(container, tradingCardId))
  if (existingProductId) return { productId: existingProductId, freshProductVariant: null }

  const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const numberForms = cardNumberForms(input.cardNumber)
  const handle = `${handleSegment(input.cardSetProviderSetCode)}-${handleSegment(numberForms.normalised)}-${shortId().toLowerCase()}`
  const variantSku = `HT-PULSE-${shortId()}`
  const dimensions: VariantDimensions = { condition: input.condition, finish: input.finish, specialTreatment: input.specialTreatment }
  const optionValue = variantOptionValue(dimensions)

  const product = await products.createProducts({
    title: input.name, handle, status: "draft",
    options: [{ title: "Card Variant", values: [optionValue] }],
    variants: [{ title: optionValue, sku: variantSku, manage_inventory: true, options: { "Card Variant": optionValue } }],
    ...(input.categoryId ? { category_ids: [input.categoryId] } : {}),
  })
  const productVariantId = product.variants?.[0]?.id
  if (!productVariantId) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Product was created without its variant")
  await ensureSingleInventoryItemForProductVariant(container, productVariantId, variantSku)

  const link = container.resolve(ContainerRegistrationKeys.LINK)
  try {
    await link.create({ [Modules.PRODUCT]: { product_id: product.id }, [TRADING_CARDS_MODULE]: { trading_card_id: tradingCardId } })
  } catch (linkError) {
    // Ambiguous outcome — trust a fresh read of committed state over the
    // thrown error (it may have committed anyway, or a concurrent repairer
    // may have linked a different Product first).
    const winnerProductId = await readTradingCardProductId(container, tradingCardId)
    if (winnerProductId) return { productId: winnerProductId, freshProductVariant: null }
    throw linkError
  }

  return { productId: product.id, freshProductVariant: { productVariantId, dimensions } }
}

const resolveOrCreateCardStep = createStep(
  "resolve-or-create-card",
  async (input: CreateCardFromInventoryRowInput & { cardSetId: string }, { container }) => {
    const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    const numberForms = cardNumberForms(input.cardNumber)
    const identityFilters = { card_set_id: input.cardSetId, card_number_normalised: numberForms.normalised }

    const [existingCard] = await cards.listTradingCards(identityFilters, { take: 1 })
    let tradingCardId: string
    if (existingCard) {
      tradingCardId = existingCard.id
    } else {
      try {
        const created = await cards.createTradingCards({
          card_set_id: input.cardSetId, name: input.name, search_name: input.name.toLowerCase(),
          card_number: numberForms.original, card_number_normalised: numberForms.normalised,
          rarity_raw: input.rarityRaw, rarity_comparison: input.rarityRaw == null ? null : rarityComparisonForm(input.rarityRaw),
          origin: RECORD_ORIGIN.PULSE,
        })
        tradingCardId = created.id
      } catch (error) {
        // Identity race: `IDX_trading_card_identity` is what actually broke
        // the tie — our own insert never committed, so there is nothing of
        // ours to preserve here (only the winner's row exists).
        const [afterRace] = await cards.listTradingCards(identityFilters, { take: 1 })
        if (!afterRace) throw error
        tradingCardId = afterRace.id
      }
    }

    const { productId, freshProductVariant } = await ensureProductChainForTradingCard(container, input, tradingCardId)
    return new StepResponse({ tradingCardId, productId, freshProductVariant })
  },
  // No compensation, and no same-step delete either — see the invariant
  // note above `delay()`. The TradingCard this step creates or finds is a
  // committed identity anchor the moment it exists; `ensureProductChainFor
  // TradingCard` completes or repairs its Product chain by creating or
  // reusing, never by deleting.
)

// ---------------------------------------------------------------------
// Step 3: resolve-or-create TradingCardVariant + ProductVariant + InventoryItem
// ---------------------------------------------------------------------

interface CardStepResult { tradingCardId: string; productId: string; freshProductVariant: FreshProductVariant | null }

/**
 * Single, no-retry read of a TradingCardVariant's currently-linked
 * ProductVariant id (may be missing right now). InventoryItem resolution is
 * deliberately not this function's concern — that's
 * `ensureSingleInventoryItemForProductVariant`'s job, under its lock, since
 * a ProductVariant can have more than one linked InventoryItem (inventory
 * kits) and picking one here without the lock/count-check would reintroduce
 * exactly the unsafe `inventory_items[0]` assumption this file removed.
 */
async function readVariantProductVariantId(
  container: MedusaContainer, tradingCardVariantId: string,
): Promise<string | undefined> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "trading_card_variant", fields: ["id", "product_variant.id"], filters: { id: tradingCardVariantId },
  })
  return (data[0]?.product_variant as { id?: string } | null)?.id
}

/** Finds an existing ProductVariant on `productId` whose "Card Variant" option value matches `optionValue`, if any. */
async function findProductVariantByOptionValue(
  container: MedusaContainer, productId: string, optionValue: string,
): Promise<string | undefined> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_variant", fields: ["id", "options.value"], filters: { product_id: productId },
  })
  const match = (data as Array<{ id: string; options?: Array<{ value?: string }> | null }>).find(
    (variant) => variant.options?.some((option) => option.value === optionValue),
  )
  return match?.id
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
 * exists. Returns the created value's id, or `null` if it already existed.
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

/**
 * Ensures a ProductVariant exists on `productId` for this exact
 * `dimensions` combination, never deleting anything. Medusa itself enforces
 * at most one variant per distinct option-value combination on one
 * product, so — exactly like the TradingCard/TradingCardVariant identity
 * rows elsewhere in this file — "attempt the insert, and on failure re-read
 * who actually holds this combination now" is race-safe without a
 * cross-step transaction.
 */
async function ensureProductVariantForDimensions(
  container: MedusaContainer, productId: string, dimensions: VariantDimensions,
): Promise<string> {
  const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const optionValue = variantOptionValue(dimensions)

  const existing = await findProductVariantByOptionValue(container, productId, optionValue)
  if (existing) return existing

  await addCardVariantOptionValue(products, productId, optionValue)

  const variantSku = `HT-PULSE-${shortId()}`
  let attempt = 0
  for (;;) {
    try {
      const productVariant = await products.createProductVariants({
        product_id: productId, title: optionValue, sku: variantSku, manage_inventory: true, options: { "Card Variant": optionValue },
      })
      return productVariant.id
    } catch (variantError) {
      // Two distinct, both-recoverable causes share this catch: (a) the
      // option value just added is not yet visible to
      // `createProductVariants`'s own re-resolution of the product's
      // options ("does not exist") — re-confirm and retry a bounded number
      // of times; (b) a concurrent caller already created a variant for
      // this exact option combination — Medusa's own uniqueness rejects
      // ours, which is the signal to re-read and reuse rather than a
      // genuine failure. Re-read for (b) on every attempt, since it can
      // happen on the very first try.
      const afterRace = await findProductVariantByOptionValue(container, productId, optionValue)
      if (afterRace) return afterRace
      attempt += 1
      const message = variantError instanceof Error ? variantError.message : String(variantError)
      if (attempt >= 5 || !/does not exist/i.test(message)) throw variantError
      await delay(60)
      await addCardVariantOptionValue(products, productId, optionValue)
    }
  }
}

/**
 * Ensures `tradingCardVariantId` has a complete, linked ProductVariant +
 * InventoryItem chain, repairing whichever part is missing — never
 * deleting anything. Mirrors `ensureProductChainForTradingCard`'s shape:
 *
 *   1. Bounded re-read for the common case (already linked, or a transient
 *      commit-visibility window).
 *   2. If the ProductVariant link itself is missing: reuse the `fresh` pair
 *      step 2 handed down when its dimensions match (the card's very first
 *      variant, created atomically with its Product) or ensure one via
 *      `ensureProductVariantForDimensions`, then attempt the
 *      TradingCardVariant ↔ ProductVariant link — its own 1:1 constraint
 *      makes "attempt, then re-read on failure" race-safe here too.
 *   3. Whatever ProductVariant id is now known, resolve its single
 *      InventoryItem through `ensureSingleInventoryItemForProductVariant` —
 *      always, even when the ProductVariant came from `fresh` — so every
 *      path through this function goes through the same lock (see that
 *      function's own doc comment for why).
 */
async function ensureVariantProductChain(
  container: MedusaContainer, cardResult: CardStepResult, dimensions: VariantDimensions, tradingCardVariantId: string,
): Promise<{ productVariantId: string; inventoryItemId: string }> {
  let productVariantId = await retryUntilDefined(() => readVariantProductVariantId(container, tradingCardVariantId))

  if (!productVariantId) {
    const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
    const fresh = cardResult.freshProductVariant
    productVariantId = (fresh && sameVariantDimensions(fresh.dimensions, dimensions))
      ? fresh.productVariantId
      : await ensureProductVariantForDimensions(container, cardResult.productId, dimensions)

    const ownerProductId = await retrieveProductVariantOwner(container, productVariantId)
    await cards.assertVariantProductHierarchy({ productVariantProductId: ownerProductId, tradingCardProductId: cardResult.productId })

    const link = container.resolve(ContainerRegistrationKeys.LINK)
    try {
      await link.create({ [Modules.PRODUCT]: { product_variant_id: productVariantId }, [TRADING_CARDS_MODULE]: { trading_card_variant_id: tradingCardVariantId } })
    } catch (linkError) {
      // Ambiguous outcome — trust a fresh read over the thrown error, same
      // as `ensureProductChainForTradingCard`'s own link attempt.
      const afterProductVariantId = await readVariantProductVariantId(container, tradingCardVariantId)
      if (!afterProductVariantId) throw linkError
      productVariantId = afterProductVariantId
    }
  }

  const inventoryItemId = await ensureSingleInventoryItemForProductVariant(container, productVariantId, `HT-PULSE-${shortId()}`)

  return { productVariantId, inventoryItemId }
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
    let tradingCardVariantId: string
    if (existingVariant) {
      tradingCardVariantId = existingVariant.id
    } else {
      const sku = generateSku({
        tradingCardId: input.cardResult.tradingCardId, game: input.cardGame, language: input.cardLanguage,
        setCode: input.cardSetProviderSetCode, cardNumber: input.cardNumber, cardName: input.name,
        condition: input.condition, finish: input.finish, specialTreatment: input.specialTreatment,
      })
      try {
        const created = await cards.createTradingCardVariants({
          trading_card_id: input.cardResult.tradingCardId, condition: input.condition, condition_source: "EXPLICIT",
          finish: input.finish, finish_confirmed: input.finishConfirmed,
          special_treatment: input.specialTreatment, special_treatment_confirmed: input.specialTreatmentConfirmed,
          sku, origin: RECORD_ORIGIN.PULSE,
        })
        tradingCardVariantId = created.id
      } catch (error) {
        // Identity race: `IDX_trading_card_variant_identity` broke the tie
        // — our own insert never committed, nothing of ours to preserve.
        const afterRace = await retryUntilDefined(async () => {
          const [found] = await cards.listTradingCardVariants(variantFilters, { take: 1 })
          return found
        })
        if (!afterRace) throw error
        tradingCardVariantId = afterRace.id
      }
    }

    const { productVariantId, inventoryItemId } = await ensureVariantProductChain(container, input.cardResult, dimensions, tradingCardVariantId)
    return new StepResponse({ tradingCardVariantId, productVariantId, inventoryItemId })
  },
  // No compensation, and no same-step delete either — see the invariant
  // note above `delay()`. The TradingCardVariant this step creates or finds
  // is a committed identity anchor the moment it exists; `ensureVariant
  // ProductChain` completes or repairs its ProductVariant/InventoryItem
  // chain by creating or reusing, never by deleting.
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
