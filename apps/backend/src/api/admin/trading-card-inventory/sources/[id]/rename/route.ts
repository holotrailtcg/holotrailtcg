import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { adminActor, idParamsSchema, parseAdminInput, renameSourceBodySchema, safeAdminWrite, toSafeInventorySourceDto, tradingCardInventoryService } from "../../../shared"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const body = parseAdminInput(renameSourceBodySchema, req.body)
  const service = tradingCardInventoryService(req)
  const source = await safeAdminWrite(() => service.renameInventorySource({
    id, displayName: body.displayName, actor: adminActor(req), source: "MANUAL",
  }))
  res.status(200).json({ source: toSafeInventorySourceDto(source as Record<string, unknown>) })
}
