import { randomUUID } from "node:crypto"
import type { AuthenticatedMedusaRequest, MedusaRequest } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { EBAY_INTEGRATION_MODULE } from "../../../../modules/ebay-integration"
import type EbayIntegrationModuleService from "../../../../modules/ebay-integration/service"
import { EBAY_ENVIRONMENT, type EbayEnvironment } from "../../../../modules/ebay-integration/types"
import { adminActor, assertTrustedAdminOrigin, parseAdminInput } from "../connections/shared"
import { syncStoreCategoriesToMedusaWorkflow } from "../../../../workflows/ebay-integration/sync-store-categories-to-medusa"
export { adminActor, assertTrustedAdminOrigin, parseAdminInput }
export const environmentSchema = z.enum([EBAY_ENVIRONMENT.SANDBOX, EBAY_ENVIRONMENT.PRODUCTION])
const id = z.string().trim().min(1).max(128).regex(/^[^\u0000-\u001f,]+$/)
export const createCategorySchema = z.object({ environment: environmentSchema, externalId: id, name: z.string().trim().min(1).max(255), parentExternalId: id.nullish(), siblingOrder: z.number().int().min(0).max(2147483647) }).strict()
export const updateCategorySchema = createCategorySchema.omit({ externalId: true }).extend({ externalId: id.optional() }).strict()
export const csvSchema = z.object({ environment: environmentSchema, csv: z.string().min(1).max(1024 * 1024), confirm: z.literal(true).optional() }).strict()
export const importCsvSchema = z.object({ previewId: z.string().trim().min(1).max(128), csv: z.string().min(1).max(1024 * 1024), confirm: z.literal(true) }).strict()
export const removeSchema = z.object({ environment: environmentSchema, reason: z.string().trim().min(1).max(500), confirm: z.literal(true) }).strict()
export function service(req: MedusaRequest) { return req.scope.resolve<EbayIntegrationModuleService>(EBAY_INTEGRATION_MODULE) }
export async function categoryWrite<T>(req: AuthenticatedMedusaRequest, environment: EbayEnvironment, action: () => Promise<T>) {
  assertTrustedAdminOrigin(req)
  void environment
  return action()
}
export async function previewBoundCategoryWrite<T>(req: AuthenticatedMedusaRequest, previewId: string, actorId: string, action: () => Promise<T>) {
  assertTrustedAdminOrigin(req)
  void previewId
  void actorId
  return action()
}
export const correlation = () => randomUUID()

/**
 * Best-effort Medusa sync fired immediately after a Store category mutation
 * commits. The category catalogue mutation is already durable at this point
 * — a Medusa sync failure here is surfaced to the caller (so Admin can see
 * it and retry) but never rolled back or re-thrown, since Medusa reachability
 * must never block the local catalogue from being the source of truth. Use
 * the explicit "Sync categories to Medusa" action to retry a failed sync.
 */
export async function triggerMedusaSync(
  req: AuthenticatedMedusaRequest,
  environment: EbayEnvironment,
  actorId: string,
): Promise<{ status: "synced" | "failed"; summary?: Record<string, unknown> & { failed: number }; error?: string }> {
  try {
    const { result } = await syncStoreCategoriesToMedusaWorkflow(req.scope).run({
      input: { environment, actorId, correlationId: correlation() },
    })
    return { status: "synced", summary: { ...result } }
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message.slice(0, 500) : "Unknown Medusa sync error." }
  }
}
