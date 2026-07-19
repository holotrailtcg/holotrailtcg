import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { processTcgdexLookupBatchWorkflow } from "../../../../../../../../workflows/trading-card-inventory/process-tcgdex-lookup-batch"
import { idParamsSchema, parseAdminInput, safeAdminWrite } from "../../../../shared"

const processBatchBodySchema = z.object({
  batchSize: z.coerce.number().int().min(1).max(25).default(10),
}).strict()

/**
 * Processes up to `batchSize` not-yet-looked-up cards from this snapshot's
 * still-unmatched rows against TCGdex, caching each result. The caller (the
 * progress page) repeats this call until `remaining` is 0 — see
 * `ProcessTcgdexLookupBatchResult` for why this is a client-driven loop
 * rather than a single long-running call: there is no background job queue
 * in this app, and a single request covering hundreds of live TCGdex calls
 * would risk an HTTP timeout.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const body = parseAdminInput(processBatchBodySchema, req.body ?? {})

  const { result } = await safeAdminWrite(() => processTcgdexLookupBatchWorkflow(req.scope).run({
    input: { snapshotId: id, batchSize: body.batchSize },
  }))

  res.status(200).json({ progress: result })
}
