import { model } from "@medusajs/framework/utils"
import { EBAY_ENVIRONMENT } from "../types"

/**
 * E2B configurable assignment rule. `conditions` is a small, versionless JSON
 * array of `{ field, values }` — every condition must match (AND) for the
 * rule to apply; a rule with zero conditions never matches (use the
 * dedicated fallback category for an unconditional catch-all instead, so
 * there is always exactly one obvious place to look for "what happens when
 * nothing matches").
 */
const EbayCategoryAssignmentRule = model
  .define({ name: "EbayCategoryAssignmentRule", tableName: "ebay_integration_category_assignment_rule" }, {
    id: model.id({ prefix: "ebcatrule" }).primaryKey(),
    environment: model.enum(Object.values(EBAY_ENVIRONMENT)),
    ebay_account_id: model.text(),
    name: model.text(),
    enabled: model.boolean().default(true),
    priority: model.number(),
    target_store_category_id: model.text(),
    conditions: model.json(),
  })
  .indexes([
    { name: "IDX_ebay_category_rule_scope", on: ["environment", "ebay_account_id", "priority"], where: "deleted_at is null" },
    { name: "IDX_ebay_category_rule_target", on: ["target_store_category_id"], where: "deleted_at is null" },
  ])
  .checks([
    { name: "CK_ebay_category_rule_priority", expression: (c) => `${c.priority} >= 0` },
    { name: "CK_ebay_category_rule_name_length", expression: (c) => `length(${c.name}) between 1 and 255` },
  ])

export default EbayCategoryAssignmentRule
