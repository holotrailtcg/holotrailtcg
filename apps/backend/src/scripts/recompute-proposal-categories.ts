import type { MedusaContainer } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import type { EbayEnvironment } from "../modules/ebay-integration/types"
import { recomputeProposalCategoriesForSnapshot } from "../workflows/trading-card-inventory/recompute-proposal-categories"

/**
 * KEEP — reusable ops tool, not a one-off. The eBay category-assignment
 * ruleset is expected to keep growing (more sets, more rarities, PRODUCTION
 * rules once that environment connects) — every time it changes, proposals
 * created under the old rules need this to pick up the new ones. Takes
 * `snapshotId`/`environment` as inputs, no hard-coded data; same shape as
 * the already-kept `retry-snapshot-matching.ts`.
 *
 * The Admin proposals page also has a "Sync eBay categories" button that
 * calls this exact same logic (`recomputeProposalCategoriesForSnapshot`) —
 * this script remains for scripted/bulk use across many snapshots at once.
 *
 * Usage (environment auto-detected from the single CONNECTED eBay
 * environment if TCI_RECOMPUTE_ENVIRONMENT is omitted):
 *   $env:TCI_RECOMPUTE_SNAPSHOT_ID = "tcisnap_..."
 *   pnpm exec medusa exec ./src/scripts/recompute-proposal-categories.ts
 */
export default async function recomputeProposalCategories({ container }: { container: MedusaContainer }) {
  const snapshotId = process.env.TCI_RECOMPUTE_SNAPSHOT_ID?.trim()
  if (!snapshotId) throw new MedusaError(MedusaError.Types.INVALID_DATA, "TCI_RECOMPUTE_SNAPSHOT_ID is required")
  const environment = process.env.TCI_RECOMPUTE_ENVIRONMENT?.trim() as EbayEnvironment | undefined

  const { recomputedCount, results } = await recomputeProposalCategoriesForSnapshot(container, { snapshotId, environment })
  console.log(JSON.stringify({ recomputedCount, results }, null, 2))
}
