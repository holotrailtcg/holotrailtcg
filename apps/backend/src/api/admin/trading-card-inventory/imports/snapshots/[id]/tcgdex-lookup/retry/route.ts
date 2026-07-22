import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { retryTcgdexLookupCandidateWorkflow } from "../../../../../../../../workflows/trading-card-inventory/retry-tcgdex-lookup-candidate"
import { adminActor, idParamsSchema, parseAdminInput, safeAdminRead, safeAdminWrite, tradingCardInventoryService } from "../../../../shared"

const retryBodySchema = z.object({
  tcgdexSetId: z.string().trim().min(1).max(128),
  cardNumber: z.string().trim().min(1).max(32),
}).strict()

/**
 * Stage 1: manual retry for one failed TCGdex lookup candidate. `id` is the
 * snapshot only used to resolve the source's configured language (every row
 * in an import shares one language — see Stage 1's language rules); the
 * retried identity itself is `(tcgdexSetId, cardNumber)`, not tied to any
 * one row, since the same card identity can appear on many rows/snapshots.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const body = parseAdminInput(retryBodySchema, req.body ?? {})
  const inventory = tradingCardInventoryService(req)

  const summary = await safeAdminRead(() => inventory.getSnapshotImportSummary(id))
  const language = summary.inventorySourceLanguage as string | null
  if (!language) {
    res.status(422).json({ error: "This snapshot's source has no configured language; cannot retry a TCGdex lookup." })
    return
  }

  const { result } = await safeAdminWrite(() => retryTcgdexLookupCandidateWorkflow(req.scope).run({
    input: {
      actor: adminActor(req), language: language as never,
      tcgdexSetId: body.tcgdexSetId, cardNumber: body.cardNumber,
    },
  }))

  res.status(200).json({ result })
}
