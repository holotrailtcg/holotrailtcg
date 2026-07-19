import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { bulkReviewTcgdexCandidatesWorkflow } from "../../../../../../../../workflows/trading-card-inventory/bulk-review-tcgdex-candidates"
import { adminActor, idParamsSchema, parseAdminInput, safeAdminWrite } from "../../../../shared"

const reviewBodySchema = z.object({
  candidateIds: z.array(z.string().min(1)).min(1).max(100),
  action: z.enum(["ACCEPT", "REJECT"]),
}).strict()

/**
 * Bulk accept/reject, per-item partial success — one candidate that fails
 * (or whose rows have unresolved finish/treatment) never blocks the others,
 * mirroring the existing bulk-apply-proposals endpoint's contract. 200
 * whenever the request itself was valid; per-item outcomes live in
 * `results`.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const body = parseAdminInput(reviewBodySchema, req.body ?? {})

  const { result } = await safeAdminWrite(() => bulkReviewTcgdexCandidatesWorkflow(req.scope).run({
    input: { actor: adminActor(req), snapshotId: id, candidateIds: body.candidateIds, action: body.action },
  }))

  res.status(200).json({ results: result.results })
}
