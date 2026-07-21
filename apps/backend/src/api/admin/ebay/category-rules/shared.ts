import { randomUUID } from "node:crypto"
import type { AuthenticatedMedusaRequest, MedusaRequest } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { EBAY_INTEGRATION_MODULE } from "../../../../modules/ebay-integration"
import type EbayIntegrationModuleService from "../../../../modules/ebay-integration/service"
import { CATEGORY_ASSIGNMENT_CONDITION_FIELD, EBAY_ENVIRONMENT } from "../../../../modules/ebay-integration/types"
import { adminActor, assertTrustedAdminOrigin, parseAdminInput } from "../connections/shared"

export { adminActor, assertTrustedAdminOrigin, parseAdminInput }
export const environmentSchema = z.enum([EBAY_ENVIRONMENT.SANDBOX, EBAY_ENVIRONMENT.PRODUCTION])
export const idParamsSchema = z.object({ id: z.string().trim().min(1).max(128) })

const conditionValue = z.string().trim().min(1).max(255)
export const conditionSchema = z
  .object({
    field: z.enum([
      CATEGORY_ASSIGNMENT_CONDITION_FIELD.LANGUAGE,
      CATEGORY_ASSIGNMENT_CONDITION_FIELD.FINISH,
      CATEGORY_ASSIGNMENT_CONDITION_FIELD.RARITY,
      CATEGORY_ASSIGNMENT_CONDITION_FIELD.SPECIAL_TREATMENT,
      CATEGORY_ASSIGNMENT_CONDITION_FIELD.SET_CODE,
      CATEGORY_ASSIGNMENT_CONDITION_FIELD.SET_NAME,
    ]),
    values: z.array(conditionValue).min(1).max(50),
  })
  .strict()

export const ruleBodySchema = z
  .object({
    environment: environmentSchema,
    name: z.string().trim().min(1).max(255),
    enabled: z.boolean(),
    priority: z.number().int().min(0).max(2147483647),
    targetStoreCategoryId: z.string().trim().min(1).max(128),
    conditions: z.array(conditionSchema).max(20),
  })
  .strict()

export const fallbackBodySchema = z
  .object({ environment: environmentSchema, fallbackStoreCategoryId: z.string().trim().min(1).max(128).nullable() })
  .strict()

export function service(req: MedusaRequest) {
  return req.scope.resolve<EbayIntegrationModuleService>(EBAY_INTEGRATION_MODULE)
}
export const correlation = () => randomUUID()
export async function categoryWrite<T>(req: AuthenticatedMedusaRequest, action: () => Promise<T>): Promise<T> {
  assertTrustedAdminOrigin(req)
  return action()
}
