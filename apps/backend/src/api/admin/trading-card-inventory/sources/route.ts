import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  adminActor, createSourceBodySchema, parseAdminInput, safeAdminRead, safeAdminWrite, sourceListQuerySchema,
  toSafeInventorySourceDto, tradingCardInventoryService,
} from "../shared"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = parseAdminInput(sourceListQuerySchema, req.query)
  const service = tradingCardInventoryService(req)
  const filters: Record<string, unknown> = {}
  if (query.status) filters.status = query.status
  if (query.provider) filters.provider = query.provider
  const [rows, count] = await safeAdminRead(() =>
    service.listAndCountInventorySources(filters, { skip: query.offset, take: query.limit, order: { created_at: "DESC" } })
  )
  res.status(200).json({
    sources: rows.map((row: Record<string, unknown>) => toSafeInventorySourceDto(row)),
    count, limit: query.limit, offset: query.offset,
  })
}

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const body = parseAdminInput(createSourceBodySchema, req.body)
  const service = tradingCardInventoryService(req)
  const source = await safeAdminWrite(() => service.createInventorySource({
    actor: adminActor(req), source: "MANUAL",
    displayName: body.displayName, provider: body.provider, language: body.language ?? null,
    defaultCurrencyCode: body.defaultCurrencyCode ?? null, defaultPricingProfileKey: body.defaultPricingProfileKey ?? null,
    defaultStorefrontCategoryId: body.defaultStorefrontCategoryId ?? null, notes: body.notes ?? null,
  }))
  res.status(201).json({ source: toSafeInventorySourceDto(source as Record<string, unknown>) })
}
