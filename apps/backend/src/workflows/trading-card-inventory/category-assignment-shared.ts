import type { MedusaContainer } from "@medusajs/framework/types"
import { EBAY_INTEGRATION_MODULE } from "../../modules/ebay-integration"
import type EbayIntegrationModuleService from "../../modules/ebay-integration/service"
import type { CategoryAssignmentCardAttributes, CategoryAssignmentResult } from "../../modules/ebay-integration/category-assignment/evaluate"
import { EBAY_CONNECTION_STATUS, type EbayEnvironment } from "../../modules/ebay-integration/types"
import { TRADING_CARD_INVENTORY_MODULE } from "../../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../../modules/trading-card-inventory/service"
import { TRADING_CARDS_MODULE } from "../../modules/trading-cards"
import type TradingCardsModuleService from "../../modules/trading-cards/service"

/**
 * Shared by the live `reconcile-inventory-snapshot` annotation path, the
 * Admin "Sync eBay categories" action, and the `recompute-proposal-categories`
 * ops script — one place computing card attributes, evaluating the ruleset,
 * and applying the result, so all three ways of triggering this stay in sync
 * with each other (in particular, the auto-confirm-on-RULE_MATCH behaviour).
 */

/** Only ever resolves an environment automatically when exactly one is currently CONNECTED — there is no unambiguous ruleset to evaluate against otherwise. */
export async function resolveCategoryAssignmentEnvironment(ebayIntegration: EbayIntegrationModuleService): Promise<EbayEnvironment | null> {
  const connections = await ebayIntegration.listSafeConnections()
  const connected = connections.filter((connection) => connection.status === EBAY_CONNECTION_STATUS.CONNECTED)
  return connected.length === 1 ? (connected[0].environment as EbayEnvironment) : null
}

async function buildCategoryAssignmentAttributes(
  inventory: TradingCardInventoryModuleService,
  cards: TradingCardsModuleService,
  snapshotId: string,
  language: string | null,
  proposal: Record<string, unknown>,
): Promise<CategoryAssignmentCardAttributes> {
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
  return attributes
}

/**
 * Evaluates one proposal against the ruleset and applies the outcome:
 * always records the proposal (rule match, fallback, or no match), and —
 * only for a precise `RULE_MATCH` — auto-confirms it immediately. A
 * `FALLBACK` or `NO_MATCH` outcome still requires a reviewer's manual choice.
 */
export async function applyCategoryAssignmentToProposal(
  inventory: TradingCardInventoryModuleService,
  ebayIntegration: EbayIntegrationModuleService,
  cards: TradingCardsModuleService,
  environment: EbayEnvironment,
  snapshotId: string,
  language: string | null,
  proposal: Record<string, unknown>,
): Promise<{ attributes: CategoryAssignmentCardAttributes; result: CategoryAssignmentResult }> {
  const attributes = await buildCategoryAssignmentAttributes(inventory, cards, snapshotId, language, proposal)
  const result = await ebayIntegration.evaluateCategoryAssignment(environment, attributes)
  await inventory.setProposedCategoryAssignment({
    proposalId: proposal.id as string,
    storeCategoryId: result.storeCategoryId,
    reason: result.reason,
    ruleId: result.matchedRuleId,
  })
  if (result.outcome === "RULE_MATCH" && result.storeCategoryId) {
    await inventory.confirmProposalCategory({
      proposalId: proposal.id as string,
      storeCategoryId: result.storeCategoryId,
      actor: "system:category-rule-auto-confirm",
      source: "SYSTEM",
      // A reviewer may have manually confirmed a different category between
      // this proposal being read as eligible and this auto-confirm running —
      // never let the automatic rule match overwrite that.
      requireUnconfirmed: true,
    })
  }
  return { attributes, result }
}

/** Resolves the shared dependencies from the container — used by every caller of `applyCategoryAssignmentToProposal`. */
export function resolveCategoryAssignmentDependencies(container: MedusaContainer) {
  return {
    ebayIntegration: container.resolve<EbayIntegrationModuleService>(EBAY_INTEGRATION_MODULE),
    inventory: container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE),
    cards: container.resolve<TradingCardsModuleService>(TRADING_CARDS_MODULE),
  }
}
