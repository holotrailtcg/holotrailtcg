import type { MedusaContainer } from "@medusajs/framework"
import { EBAY_INTEGRATION_MODULE } from "../modules/ebay-integration"
import type EbayIntegrationModuleService from "../modules/ebay-integration/service"

/**
 * Read-only diagnostic: prints just the level-3 Scarlet & Violet set
 * categories under "Illustration Rares & SIRs" and "Reverse Holos", as a
 * compact id/name table — narrower than the full 124-row dump so rule
 * target ids can be transcribed accurately.
 *
 * Usage: pnpm exec medusa exec ./src/scripts/list-sv-set-categories.ts
 */
export default async function listSvSetCategories({ container }: { container: MedusaContainer }) {
  const ebayIntegration = container.resolve<EbayIntegrationModuleService>(EBAY_INTEGRATION_MODULE)
  const { categories } = await ebayIntegration.listStoreCategories("SANDBOX")
  const relevant = categories.filter((c) =>
    c.level === 3 &&
    (c.path.startsWith("Illustration Rares & SIRs / Scarlet & Violet Series /") ||
     c.path.startsWith("Reverse Holos / Scarlet & Violet Series /")),
  )
  const table = relevant.map((c) => ({ id: c.id, name: c.name, path: c.path }))
  console.log(JSON.stringify(table, null, 1))
}
