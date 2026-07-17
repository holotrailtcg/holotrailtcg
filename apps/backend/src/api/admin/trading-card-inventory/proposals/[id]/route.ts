import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { INVENTORY_AUDIT_ENTITY_TYPE } from "../../../../../modules/trading-card-inventory/types"
import {
  idParamsSchema, parseAdminInput, proposalAuditHistoryQuerySchema, safeAdminRead,
  toSafeInventoryAuditEntryDto, toSafeInventoryProposalDto, tradingCardInventoryService,
} from "../../shared"

/** Full proposal detail plus its bounded, newest-first audit-history timeline. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const query = parseAdminInput(proposalAuditHistoryQuerySchema, req.query)
  const service = tradingCardInventoryService(req)

  const proposal = await safeAdminRead(() => service.retrieveInventoryProposal(id))
  const history = await safeAdminRead(() => service.listInventoryAuditEntries(
    { entity_type: INVENTORY_AUDIT_ENTITY_TYPE.INVENTORY_PROPOSAL, entity_id: id },
    { take: query.limit, order: { created_at: "DESC" } }
  ))

  res.status(200).json({
    proposal: toSafeInventoryProposalDto(proposal as Record<string, unknown>),
    history: (history as Record<string, unknown>[]).map((entry) => toSafeInventoryAuditEntryDto(entry)),
  })
}
