import type { MedusaContainer } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { EBAY_INTEGRATION_MODULE } from "../modules/ebay-integration"
import type EbayIntegrationModuleService from "../modules/ebay-integration/service"
import { EBAY_CONNECTION_STATUS } from "../modules/ebay-integration/types"
import { TRADING_CARD_INVENTORY_MODULE } from "../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../modules/trading-card-inventory/service"

/**
 * Read-only diagnostic: dumps the exact state
 * `annotateCategoryProposals` (Stage E2B, `reconcile-inventory-snapshot.ts`)
 * depends on — connected eBay environments, configured rules/fallback, and
 * each in-scope proposal's already-computed category assignment — so a
 * predicted "will this auto-assign correctly on Approve/Apply" answer can be
 * given from real data instead of guessed.
 *
 * Usage:
 *   $env:TCI_INSPECT_SNAPSHOT_ID = "tcisnap_..."
 *   pnpm exec medusa exec ./src/scripts/inspect-category-assignment-state.ts
 */
export default async function inspectCategoryAssignmentState({ container }: { container: MedusaContainer }) {
  const snapshotId = process.env.TCI_INSPECT_SNAPSHOT_ID?.trim()
  if (!snapshotId) throw new MedusaError(MedusaError.Types.INVALID_DATA, "TCI_INSPECT_SNAPSHOT_ID is required")

  const ebayIntegration = container.resolve<EbayIntegrationModuleService>(EBAY_INTEGRATION_MODULE)
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)

  const connections = await ebayIntegration.listSafeConnections()
  const connectedEnvironments = connections
    .filter((connection) => connection.status === EBAY_CONNECTION_STATUS.CONNECTED)
    .map((connection) => connection.environment)

  const rulesByEnvironment: Record<string, unknown> = {}
  const settingsByEnvironment: Record<string, unknown> = {}
  for (const environment of ["SANDBOX", "PRODUCTION"] as const) {
    try {
      rulesByEnvironment[environment] = await ebayIntegration.listCategoryAssignmentRules(environment)
      settingsByEnvironment[environment] = await ebayIntegration.getCategoryAssignmentSettings(environment)
    } catch (error) {
      rulesByEnvironment[environment] = { error: error instanceof Error ? error.message : String(error) }
      settingsByEnvironment[environment] = { error: error instanceof Error ? error.message : String(error) }
    }
  }

  const proposals = await inventory.listInventoryProposals({ inventory_snapshot_id: snapshotId }) as Record<string, unknown>[]
  const relevantProposals = proposals.map((p) => ({
    id: p.id,
    provider_reference: p.provider_reference,
    change_kind: p.change_kind,
    review_status: p.review_status,
    trading_card_variant_id: p.trading_card_variant_id,
    proposed_ebay_store_category_id: p.proposed_ebay_store_category_id,
    proposed_category_reason: p.proposed_category_reason,
    proposed_category_rule_id: p.proposed_category_rule_id,
    confirmed_ebay_store_category_id: p.confirmed_ebay_store_category_id,
  }))

  console.log(JSON.stringify({
    connections,
    connectedEnvironments,
    unambiguousEnvironment: connectedEnvironments.length === 1 ? connectedEnvironments[0] : null,
    rulesByEnvironment,
    settingsByEnvironment,
    proposals: relevantProposals,
  }, null, 2))
}
