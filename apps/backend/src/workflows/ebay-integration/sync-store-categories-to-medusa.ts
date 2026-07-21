import type { IProductModuleService, MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { EBAY_INTEGRATION_MODULE } from "../../modules/ebay-integration"
import type EbayIntegrationModuleService from "../../modules/ebay-integration/service"
import type { StoreCategoryDto } from "../../modules/ebay-integration/service"
import type { EbayEnvironment } from "../../modules/ebay-integration/types"

export interface SyncStoreCategoriesToMedusaInput {
  environment: EbayEnvironment
  actorId: string
  correlationId: string
}

export interface SyncStoreCategoriesToMedusaResult {
  scanned: number
  created: number
  updated: number
  unchanged: number
  failed: number
  failures: Array<{ categoryId: string; externalId: string; message: string }>
}

/**
 * Full, idempotent reconciliation of every active local Store category
 * against Medusa Product Categories, in level order (parents before
 * children) so a child's `parent_category_id` can always resolve to an
 * already-synced parent. Safe to run repeatedly: an already-linked,
 * unchanged category is a no-op; a REMOVED local category is left entirely
 * alone on the Medusa side (its Product Category, if any, is never deleted
 * — it may still be referenced by a product).
 *
 * A single category's create/update failure never aborts the run — it is
 * recorded in `failures` and reconciliation continues, so one bad row can't
 * block the rest of the (small, ~124-row) catalogue from syncing.
 */
export async function syncStoreCategoriesToMedusa(
  container: MedusaContainer,
  input: SyncStoreCategoriesToMedusaInput,
): Promise<SyncStoreCategoriesToMedusaResult> {
  const ebayIntegration = container.resolve<EbayIntegrationModuleService>(EBAY_INTEGRATION_MODULE)
  const productModuleService = container.resolve<IProductModuleService>(Modules.PRODUCT)

  const { categories } = await ebayIntegration.listActiveStoreCategoriesForMedusaSync(input.environment)

  const medusaIdByExternalId = new Map<string, string>()
  const rankByParent = new Map<string, number>()
  const result: SyncStoreCategoriesToMedusaResult = { scanned: categories.length, created: 0, updated: 0, unchanged: 0, failed: 0, failures: [] }

  const sorted = [...categories].sort((a, b) => a.level - b.level || a.siblingOrder - b.siblingOrder || a.externalId.localeCompare(b.externalId))

  for (const category of sorted) {
    try {
      const parentMedusaId = category.parentExternalId ? (medusaIdByExternalId.get(category.parentExternalId) ?? null) : null
      const rankKey = parentMedusaId ?? "__root__"
      const rank = rankByParent.get(rankKey) ?? 0
      rankByParent.set(rankKey, rank + 1)

      const outcome = await reconcileOneCategory(productModuleService, category, parentMedusaId, rank)
      if (outcome.medusaCategoryId) medusaIdByExternalId.set(category.externalId, outcome.medusaCategoryId)

      if (outcome.action === "created") {
        await ebayIntegration.linkStoreCategoryToMedusaCategory(category.id, outcome.medusaCategoryId)
        result.created += 1
      } else if (outcome.action === "updated") {
        await ebayIntegration.markStoreCategorySynced(category.id)
        result.updated += 1
      } else {
        result.unchanged += 1
      }
    } catch (error) {
      result.failed += 1
      result.failures.push({
        categoryId: category.id,
        externalId: category.externalId,
        message: error instanceof Error ? error.message.slice(0, 500) : "Unknown error while syncing this category.",
      })
    }
  }

  await ebayIntegration.recordMedusaSyncAudit({
    environment: input.environment,
    actorId: input.actorId,
    correlationId: input.correlationId,
    summary: { scanned: result.scanned, created: result.created, updated: result.updated, unchanged: result.unchanged, failed: result.failed },
    failures: result.failures,
  })

  return result
}

async function reconcileOneCategory(
  productModuleService: IProductModuleService,
  category: StoreCategoryDto,
  parentMedusaId: string | null,
  rank: number,
): Promise<{ action: "created" | "updated" | "unchanged"; medusaCategoryId: string }> {
  const existingId = category.medusaCategoryId
  if (existingId) {
    const [existing] = await productModuleService.listProductCategories({ id: [existingId] })
    if (existing) {
      const changed = existing.name !== category.name || (existing.parent_category_id ?? null) !== parentMedusaId || existing.rank !== rank
      if (changed) {
        await productModuleService.updateProductCategories(existingId, { name: category.name, parent_category_id: parentMedusaId, rank })
        return { action: "updated", medusaCategoryId: existingId }
      }
      return { action: "unchanged", medusaCategoryId: existingId }
    }
    // The linked Medusa category no longer exists (e.g. manually deleted in Admin) — recreate it, keeping the same local link target going forward.
  }
  const created = await productModuleService.createProductCategories({
    name: category.name,
    is_active: true,
    parent_category_id: parentMedusaId,
    rank,
  })
  const createdCategory = Array.isArray(created) ? created[0] : created
  return { action: "created", medusaCategoryId: createdCategory.id }
}

const syncStoreCategoriesToMedusaStep = createStep(
  "sync-store-categories-to-medusa",
  async (input: SyncStoreCategoriesToMedusaInput, { container }) =>
    new StepResponse(await syncStoreCategoriesToMedusa(container, input)),
)

export const syncStoreCategoriesToMedusaWorkflow = createWorkflow(
  "sync-store-categories-to-medusa",
  (input: SyncStoreCategoriesToMedusaInput) => new WorkflowResponse(syncStoreCategoriesToMedusaStep(input)),
)
