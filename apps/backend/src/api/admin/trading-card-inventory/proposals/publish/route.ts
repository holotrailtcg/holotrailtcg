import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { publishInventoryProposalsForSnapshot } from "../../../../../workflows/trading-card-inventory/publish-inventory-proposals"
import { adminActor, parseAdminInput, safeAdminWrite } from "../../shared"

const publishBodySchema = z.object({
  snapshotId: z.string().min(1),
  ids: z.array(z.string().min(1)).min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  afterId: z.string().min(1).optional(),
}).strict()

/**
 * "Publish selected" (`ids` given) or "Publish all" (`ids` omitted) — Approve
 * then Apply, chained per proposal, chunked via `limit`/`afterId` so the
 * Admin UI can loop this across several requests for a large snapshot. Pass
 * back the previous response's `nextCursor` as `afterId` to continue; omit
 * to start from the beginning. Always resolves every eligible proposal from
 * the snapshot itself, never trusts a client-supplied page of rows as
 * "everything".
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = parseAdminInput(publishBodySchema, req.body ?? {})

  const result = await safeAdminWrite(() => publishInventoryProposalsForSnapshot(req.scope, {
    snapshotId: body.snapshotId, actor: adminActor(req), source: "MANUAL", ids: body.ids, limit: body.limit, afterId: body.afterId,
  }))

  res.status(200).json(result)
}
