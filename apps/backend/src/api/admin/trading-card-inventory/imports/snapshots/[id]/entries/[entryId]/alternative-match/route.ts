import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { selectAlternativeTcgdexMatchWorkflow } from "../../../../../../../../../workflows/trading-card-inventory/select-alternative-tcgdex-match"
import { adminActor, parseAdminInput, safeAdminWrite } from "../../../../../shared"

const paramsSchema = z.object({ entryId: z.string().trim().min(1) })
const bodySchema = z.object({
  tcgdexSetId: z.string().trim().min(1).max(128),
  tcgdexCardId: z.string().trim().min(1).max(128),
  reason: z.string().max(500).optional(),
}).strict()

/**
 * Stage 1: selects an alternative TCGdex card for one snapshot row that
 * was matched (or unmatched) to the wrong card. Only resolves to an
 * already-existing `TradingCardVariant` at the row's own preserved
 * condition/finish/special-treatment (`NO_EXISTING_CARD_OR_VARIANT` if none
 * exists yet — create it via manual card correction instead). Rejects a
 * row whose current match has already been applied to stock.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { entryId } = parseAdminInput(paramsSchema, req.params)
  const body = parseAdminInput(bodySchema, req.body ?? {})

  const { result } = await safeAdminWrite(() => selectAlternativeTcgdexMatchWorkflow(req.scope).run({
    input: {
      actor: adminActor(req), snapshotEntryId: entryId,
      tcgdexSetId: body.tcgdexSetId, tcgdexCardId: body.tcgdexCardId, reason: body.reason ?? null,
    },
  }))

  res.status(result.outcome === "REMATCHED" ? 200 : 422).json({ result })
}
