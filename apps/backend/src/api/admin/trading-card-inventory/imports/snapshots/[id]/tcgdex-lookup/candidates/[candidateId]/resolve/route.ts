import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { resolveAmbiguousTcgdexCandidateWorkflow } from "../../../../../../../../../../workflows/trading-card-inventory/resolve-ambiguous-tcgdex-candidate"
import { adminActor, parseAdminInput, safeAdminWrite } from "../../../../../../shared"

const paramsSchema = z.object({ candidateId: z.string().trim().min(1) })
const bodySchema = z.object({
  tcgdexCardId: z.string().trim().min(1).max(128),
  reason: z.string().max(500).optional(),
}).strict()

/**
 * A reviewer's explicit pick from an `AMBIGUOUS` lookup candidate's
 * shortlist ("View matches" in the entry drawer) — promotes the candidate to
 * `MATCHED` using a fresh full TCGdex fetch of the chosen card, ready for
 * the existing accept flow (`tcgdex-lookup/review`, action `ACCEPT`).
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { candidateId } = parseAdminInput(paramsSchema, req.params)
  const body = parseAdminInput(bodySchema, req.body ?? {})

  const { result } = await safeAdminWrite(() => resolveAmbiguousTcgdexCandidateWorkflow(req.scope).run({
    input: { actor: adminActor(req), candidateId, chosenTcgdexCardId: body.tcgdexCardId, reason: body.reason ?? null },
  }))

  res.status(200).json({ candidate: result })
}
