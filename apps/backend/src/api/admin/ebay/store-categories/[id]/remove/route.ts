import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { removeSchema, service, parseAdminInput, adminActor, categoryWrite, correlation } from "../../shared"
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) { const body = parseAdminInput(removeSchema, req.body ?? {}); const id = String(req.params.id); res.json(await categoryWrite(req, body.environment, () => service(req).removeStoreCategory({ environment: body.environment, id, reason: body.reason, actorId: adminActor(req), correlationId: correlation() }))) }
