import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { adminActor, idParamsSchema, parseAdminInput, safeAdminWrite, toSafeInventoryProposalDto, tradingCardInventoryService } from "../../../shared"

const bodySchema = z.object({
  sourceEntryIds: z.array(z.string().min(1)).min(1).max(500),
  reason: z.string().max(500).optional(),
}).strict()

/**
 * Splits a proper, non-empty subset of a PENDING proposal's source rows into
 * a brand-new sibling proposal. Only a PENDING proposal can be split (an
 * applied/approved/rejected proposal returns 4xx via `splitInventoryProposal`).
 * Safe to call twice with the same selection — returns the already-created
 * sibling instead of a duplicate (`alreadySplit: true`).
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const body = parseAdminInput(bodySchema, req.body ?? {})

  const result = await safeAdminWrite(() => tradingCardInventoryService(req).splitInventoryProposal({
    proposalId: id, sourceEntryIds: body.sourceEntryIds,
    actor: adminActor(req), source: "MANUAL", reason: body.reason ?? null,
  }))

  const inventory = tradingCardInventoryService(req)
  const [original, created] = await Promise.all([
    inventory.retrieveInventoryProposal(result.originalProposalId),
    inventory.retrieveInventoryProposal(result.newProposalId),
  ])

  res.status(result.alreadySplit ? 200 : 201).json({
    alreadySplit: result.alreadySplit,
    movedEntryIds: result.movedEntryIds,
    originalProposal: toSafeInventoryProposalDto(original as unknown as Record<string, unknown>),
    newProposal: toSafeInventoryProposalDto(created as unknown as Record<string, unknown>),
  })
}
