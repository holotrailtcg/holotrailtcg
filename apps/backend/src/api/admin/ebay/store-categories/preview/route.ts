import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { csvSchema, service, parseAdminInput, adminActor, assertTrustedAdminOrigin, correlation } from "../shared"
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) { assertTrustedAdminOrigin(req); const body = parseAdminInput(csvSchema, req.body ?? {}); res.json({ preview: await service(req).previewStoreCategoryCsv({ environment: body.environment, csv: body.csv, actorId: adminActor(req), correlationId: correlation() }) }) }
