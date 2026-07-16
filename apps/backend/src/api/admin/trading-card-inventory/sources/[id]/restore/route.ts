import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { adminActor, idParamsSchema, parseAdminInput, safeAdminWrite, toSafeInventorySourceDto, tradingCardInventoryService } from "../../../shared"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { id } = parseAdminInput(idParamsSchema, req.params)
  const service = tradingCardInventoryService(req)
  const source = await safeAdminWrite(() => service.restoreInventorySource({ id, actor: adminActor(req), source: "MANUAL" }))
  res.status(200).json({ source: toSafeInventorySourceDto(source as Record<string, unknown>) })
}
