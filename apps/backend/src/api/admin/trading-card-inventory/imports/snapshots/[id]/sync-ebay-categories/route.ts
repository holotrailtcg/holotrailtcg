import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { recomputeProposalCategoriesForSnapshot } from "../../../../../../../workflows/trading-card-inventory/recompute-proposal-categories"
import { idParamsSchema, parseAdminInput, safeAdminRead, safeAdminWrite, tradingCardInventoryService } from "../../../shared"

const syncEbayCategoriesBodySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  afterId: z.string().min(1).optional(),
}).strict()

/**
 * Admin-triggered re-evaluation of eBay category proposals for every
 * unconfirmed, in-scope proposal on this snapshot — the same logic the
 * automatic reconcile-time annotation runs, but re-runnable on demand for
 * proposals that were computed before a rule existed or matched incorrectly
 * (the automatic path only ever computes a proposal once). Auto-confirms a
 * fresh precise rule match; a fallback or no-match outcome still needs a
 * reviewer's manual choice.
 *
 * Chunked via `limit`/`afterId` so the Admin UI can loop this across several
 * requests for a large snapshot. Pass back the previous response's
 * `nextCursor` as `afterId` to continue; omit to start from the beginning.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const body = parseAdminInput(syncEbayCategoriesBodySchema, req.body ?? {})
  await safeAdminRead(() => tradingCardInventoryService(req).getSnapshotImportSummary(id))

  const { recomputedCount, totalEligibleCount, remainingCount, nextCursor, results } = await safeAdminWrite(() =>
    recomputeProposalCategoriesForSnapshot(req.scope, { snapshotId: id, limit: body.limit, afterId: body.afterId }),
  )

  res.status(200).json({
    recomputedCount,
    totalEligibleCount,
    remainingCount,
    nextCursor,
    ruleMatchCount: results.filter((r) => r.result.outcome === "RULE_MATCH").length,
    fallbackCount: results.filter((r) => r.result.outcome === "FALLBACK").length,
    noMatchCount: results.filter((r) => r.result.outcome === "NO_MATCH").length,
  })
}
