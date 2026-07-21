import type { MedusaContainer } from "@medusajs/framework/types"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import type { ReconcileInventorySnapshotInput } from "../../modules/trading-card-inventory/service"
import { INVENTORY_PROPOSAL_CHANGE_KIND } from "../../modules/trading-card-inventory/types"
import { EBAY_INTEGRATION_MODULE } from "../../modules/ebay-integration"
import type EbayIntegrationModuleService from "../../modules/ebay-integration/service"
import { EBAY_CONNECTION_STATUS, type EbayEnvironment } from "../../modules/ebay-integration/types"
import type { CategoryAssignmentCardAttributes } from "../../modules/ebay-integration/category-assignment/evaluate"

/** Bulk-loads Stage 3 price locks once, then delegates the atomic comparison/write to the inventory module. */
export async function reconcileInventorySnapshotWithPriceLocks(
  container: MedusaContainer,
  input: ReconcileInventorySnapshotInput,
) {
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
  const snapshotIds = [input.snapshotId, input.previousApprovedSnapshotId].filter((id): id is string => Boolean(id))
  const variantIds = await inventory.listSnapshotVariantIds(snapshotIds)
  const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)
  const variants = variantIds.length > 0 ? await cards.listTradingCardVariants({ id: variantIds }) : []
  const reconciliation = await inventory.reconcileInventorySnapshot({
    ...input,
    priceLockedVariantIds: variants.filter((variant) => variant.price_locked).map((variant) => variant.id),
  })

  // E2B: annotate newly-created proposals with a computed category
  // assignment. Best-effort and additive — any failure here (no connected
  // eBay environment yet, no rules configured, a lookup error) simply
  // leaves affected proposals without a proposed category, which correctly
  // falls through to "requires a manual Admin choice" rather than blocking
  // reconciliation itself.
  try {
    await annotateCategoryProposals(container, input.snapshotId)
  } catch (error) {
    console.error(`[trading-card-inventory] failed to compute category proposals for snapshot ${input.snapshotId}`, error)
  }

  return reconciliation
}

/** Picks the single currently-CONNECTED eBay environment, if exactly one exists — otherwise there is no unambiguous rule set to evaluate against. */
async function resolveCategoryAssignmentEnvironment(ebayIntegration: EbayIntegrationModuleService): Promise<EbayEnvironment | null> {
  const connections = await ebayIntegration.listSafeConnections()
  const connected = connections.filter((connection) => connection.status === EBAY_CONNECTION_STATUS.CONNECTED)
  return connected.length === 1 ? connected[0].environment : null
}

async function annotateCategoryProposals(container: MedusaContainer, snapshotId: string): Promise<void> {
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
  const ebayIntegration = container.resolve<EbayIntegrationModuleService>(EBAY_INTEGRATION_MODULE)
  const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)

  const environment = await resolveCategoryAssignmentEnvironment(ebayIntegration)
  if (!environment) return

  const proposals = (await inventory.listInventoryProposals({
    inventory_snapshot_id: snapshotId,
    change_kind: [INVENTORY_PROPOSAL_CHANGE_KIND.NEW_HOLDING, INVENTORY_PROPOSAL_CHANGE_KIND.UNRESOLVED_VARIANT],
    proposed_ebay_store_category_id: null,
  })) as Record<string, unknown>[]
  if (proposals.length === 0) return

  const snapshot = await inventory.retrieveInventorySnapshot(snapshotId)
  const source = await inventory.retrieveInventorySource(snapshot.inventory_source_id as string)
  const language = (source.language as string | null) ?? null

  for (const proposal of proposals) {
    const attributes: CategoryAssignmentCardAttributes = { language }
    const providerReference = proposal.provider_reference as string | null
    if (providerReference) {
      const { rows } = await inventory.listSnapshotEntriesForAdmin(snapshotId, { providerReference }, { limit: 1, offset: 0 })
      const entry = rows[0] as Record<string, unknown> | undefined
      if (entry) {
        attributes.finish = (entry.finish_candidate as string | null) ?? null
        attributes.specialTreatment = (entry.special_treatment_candidate as string | null) ?? null
        attributes.rarity = (entry.rarity_candidate as string | null) ?? (entry.rarity_raw as string | null) ?? null
      }
    }
    const variantId = proposal.trading_card_variant_id as string | null
    if (variantId) {
      const [variant] = await cards.listTradingCardVariants({ id: [variantId] }, { relations: ["trading_card", "trading_card.card_set"] })
      const tradingCard = (variant as Record<string, unknown> | undefined)?.trading_card as Record<string, unknown> | undefined
      const cardSet = tradingCard?.card_set as Record<string, unknown> | undefined
      attributes.setCode = (cardSet?.provider_set_code as string | null) ?? null
      attributes.setName = (cardSet?.display_name as string | null) ?? null
    }

    const result = await ebayIntegration.evaluateCategoryAssignment(environment, attributes)
    await inventory.setProposedCategoryAssignment({
      proposalId: proposal.id as string,
      storeCategoryId: result.storeCategoryId,
      reason: result.reason,
      ruleId: result.matchedRuleId,
    })
  }
}

const reconcileInventorySnapshotStep = createStep(
  "reconcile-inventory-snapshot",
  async (input: ReconcileInventorySnapshotInput, { container }) =>
    new StepResponse(await reconcileInventorySnapshotWithPriceLocks(container, input)),
)

export const reconcileInventorySnapshotWorkflow = createWorkflow(
  "reconcile-inventory-snapshot",
  (input: ReconcileInventorySnapshotInput) => new WorkflowResponse(reconcileInventorySnapshotStep(input)),
)
