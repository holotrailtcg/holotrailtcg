import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { adminActor, idParamsSchema, parseAdminInput, safeAdminWrite, toSafeInventoryProposalDto, tradingCardInventoryService } from "../../../shared"

const bodySchema = z.object({
  requiresSeparateListing: z.boolean(),
  sourceEntryIds: z.array(z.string().min(1)).min(1).max(500).optional(),
  reason: z.string().max(500).optional(),
}).strict()

/**
 * Stage 1: reviewer override for "does this card require a separate
 * listing?" — applied to every row in this PENDING proposal's current
 * group (`sourceEntryIds` omitted) or just a selected subset. Since the
 * field is part of grouping identity, a partial override splits the
 * selected rows into a new sibling proposal; a full-group override just
 * relabels this proposal. Never leaves true and false rows merged.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const body = parseAdminInput(bodySchema, req.body ?? {})
  const inventory = tradingCardInventoryService(req)

  const result = await safeAdminWrite(() => inventory.setRequiresSeparateListingOverride({
    proposalId: id, sourceEntryIds: body.sourceEntryIds, requiresSeparateListing: body.requiresSeparateListing,
    actor: adminActor(req), source: "MANUAL", reason: body.reason ?? null,
  }))

  const [original, created] = await Promise.all([
    inventory.retrieveInventoryProposal(result.proposalId),
    result.newProposalId ? inventory.retrieveInventoryProposal(result.newProposalId) : Promise.resolve(null),
  ])

  res.status(200).json({
    affectedEntryIds: result.affectedEntryIds,
    proposal: toSafeInventoryProposalDto(original as unknown as Record<string, unknown>),
    newProposal: created ? toSafeInventoryProposalDto(created as unknown as Record<string, unknown>) : null,
  })
}
