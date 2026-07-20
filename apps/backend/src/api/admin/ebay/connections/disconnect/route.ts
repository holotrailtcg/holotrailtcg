import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  assertTrustedAdminOrigin, disconnectBodySchema, disconnectEnvironment, parseAdminInput,
} from "../shared"

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  assertTrustedAdminOrigin(req)
  const body = parseAdminInput(disconnectBodySchema, req.body ?? {})
  const connection = await disconnectEnvironment(req, body.environment)
  res.status(200).json({ connection })
}
