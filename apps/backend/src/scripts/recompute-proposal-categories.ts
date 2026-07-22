import type { MedusaContainer } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { EBAY_INTEGRATION_MODULE } from "../modules/ebay-integration"
import type EbayIntegrationModuleService from "../modules/ebay-integration/service"
import type { CategoryAssignmentCardAttributes, CategoryAssignmentResult } from "../modules/ebay-integration/category-assignment/evaluate"
import { TRADING_CARD_INVENTORY_MODULE } from "../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../modules/trading-card-inventory/service"
import { TRADING_CARDS_MODULE } from "../modules/trading-cards"
import type TradingCardsModuleService from "../modules/trading-cards/service"
import type { EbayEnvironment } from "../modules/ebay-integration/types"

/**
 * Re-runs `evaluateCategoryAssignment` against every PENDING, in-scope
 * proposal on a snapshot and overwrites its stored category proposal —
 * needed because `annotateCategoryProposals` only ever computes a
 * proposal once (skips anything with `proposed_ebay_store_category_id`
 * already set, even if that value is just the fallback), so proposals
 * created before a rule existed never pick the new rule up on their own.
 *
 * Usage:
 *   $env:TCI_RECOMPUTE_SNAPSHOT_ID = "tcisnap_..."
 *   $env:TCI_RECOMPUTE_ENVIRONMENT = "SANDBOX"
 *   pnpm exec medusa exec ./src/scripts/recompute-proposal-categories.ts
 */
export default async function recomputeProposalCategories({ container }: { container: MedusaContainer }) {
  const snapshotId = process.env.TCI_RECOMPUTE_SNAPSHOT_ID?.trim()
  const environment = (process.env.TCI_RECOMPUTE_ENVIRONMENT?.trim() as EbayEnvironment | undefined) ?? "SANDBOX"
  if (!snapshotId) throw new MedusaError(MedusaError.Types.INVALID_DATA, "TCI_RECOMPUTE_SNAPSHOT_ID is required")

  const ebayIntegration = container.resolve<EbayIntegrationModuleService>(EBAY_INTEGRATION_MODULE)
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)
  const cards = container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE)

  const proposals = (await inventory.listInventoryProposals({
    inventory_snapshot_id: snapshotId,
    change_kind: ["NEW_HOLDING", "UNRESOLVED_VARIANT"],
  }) as Record<string, unknown>[]).filter((p) =>
    (p.review_status === "PENDING" || p.review_status === "APPROVED") && !p.confirmed_ebay_store_category_id,
  )

  const snapshot = await inventory.retrieveInventorySnapshot(snapshotId)
  const source = await inventory.retrieveInventorySource(snapshot.inventory_source_id as string)
  const language = (source.language as string | null) ?? null

  const results: Array<{ proposalId: unknown; attributes: CategoryAssignmentCardAttributes; result: CategoryAssignmentResult }> = []
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
    results.push({ proposalId: proposal.id, attributes, result })
  }

  console.log(JSON.stringify({ recomputedCount: results.length, results }, null, 2))
}
