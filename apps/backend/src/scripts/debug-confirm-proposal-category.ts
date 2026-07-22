import type { MedusaContainer } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { EBAY_INTEGRATION_MODULE } from "../modules/ebay-integration"
import type EbayIntegrationModuleService from "../modules/ebay-integration/service"
import { TRADING_CARD_INVENTORY_MODULE } from "../modules/trading-card-inventory"
import type TradingCardInventoryModuleService from "../modules/trading-card-inventory/service"
import type { EbayEnvironment } from "../modules/ebay-integration/types"

/**
 * Read/write diagnostic: reproduces the admin route's exact confirm-category
 * call (`isActiveStoreCategory` check, then `confirmProposalCategory`) with
 * full error output, to see the real error the frontend's generic
 * "could not be confirmed" toast is hiding.
 *
 * Usage:
 *   $env:TCI_DEBUG_PROPOSAL_ID = "tciprop_..."
 *   $env:TCI_DEBUG_CATEGORY_ID = "ebstorecat_..."
 *   $env:TCI_DEBUG_ENVIRONMENT = "SANDBOX"
 *   pnpm exec medusa exec ./src/scripts/debug-confirm-proposal-category.ts
 */
export default async function debugConfirmProposalCategory({ container }: { container: MedusaContainer }) {
  const proposalId = process.env.TCI_DEBUG_PROPOSAL_ID?.trim()
  const storeCategoryId = process.env.TCI_DEBUG_CATEGORY_ID?.trim()
  const environment = (process.env.TCI_DEBUG_ENVIRONMENT?.trim() as EbayEnvironment | undefined) ?? "SANDBOX"
  if (!proposalId) throw new MedusaError(MedusaError.Types.INVALID_DATA, "TCI_DEBUG_PROPOSAL_ID is required")
  if (!storeCategoryId) throw new MedusaError(MedusaError.Types.INVALID_DATA, "TCI_DEBUG_CATEGORY_ID is required")

  const ebayIntegration = container.resolve<EbayIntegrationModuleService>(EBAY_INTEGRATION_MODULE)
  const inventory = container.resolve<TradingCardInventoryModuleService>(TRADING_CARD_INVENTORY_MODULE)

  try {
    const isActive = await ebayIntegration.isActiveStoreCategory(environment, storeCategoryId)
    console.log(JSON.stringify({ step: "isActiveStoreCategory", isActive }))
    if (!isActive) {
      console.log(JSON.stringify({ outcome: "REJECTED_AT_ACTIVE_CHECK" }))
      return
    }
    const saved = await inventory.confirmProposalCategory({ proposalId, storeCategoryId, actor: "system:debug" })
    console.log(JSON.stringify({ outcome: "SUCCESS", saved }, null, 2))
  } catch (error) {
    console.log(JSON.stringify({
      outcome: "ERROR",
      name: (error as { name?: string })?.name,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }, null, 2))
  }
}
