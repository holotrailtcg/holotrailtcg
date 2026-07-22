import type { MedusaContainer } from "@medusajs/framework"
import { EBAY_INTEGRATION_MODULE } from "../modules/ebay-integration"
import type EbayIntegrationModuleService from "../modules/ebay-integration/service"
import type { EbayEnvironment } from "../modules/ebay-integration/types"

/**
 * Read-only diagnostic: dumps every eBay Store category currently on file
 * for one environment (the imported catalogue), so category-assignment
 * rules can be designed against the actual categories rather than guessed
 * names.
 *
 * Usage:
 *   $env:TCI_CATEGORY_ENVIRONMENT = "SANDBOX"
 *   pnpm exec medusa exec ./src/scripts/list-ebay-store-categories.ts
 */
export default async function listEbayStoreCategories({ container }: { container: MedusaContainer }) {
  const environment = (process.env.TCI_CATEGORY_ENVIRONMENT?.trim() as EbayEnvironment | undefined) ?? "SANDBOX"
  const ebayIntegration = container.resolve<EbayIntegrationModuleService>(EBAY_INTEGRATION_MODULE)
  const { accountId, categories } = await ebayIntegration.listStoreCategories(environment)
  console.log(JSON.stringify({ environment, accountId, count: categories.length, categories }, null, 2))
}
