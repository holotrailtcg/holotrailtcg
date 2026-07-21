import { model } from "@medusajs/framework/utils"
import { EBAY_ENVIRONMENT } from "../types"

/** One row per (environment, account) scope — holds the configurable fallback Store Category used when no rule matches. */
const EbayCategoryAssignmentSettings = model
  .define({ name: "EbayCategoryAssignmentSettings", tableName: "ebay_integration_category_assignment_settings" }, {
    id: model.id({ prefix: "ebcatsettings" }).primaryKey(),
    environment: model.enum(Object.values(EBAY_ENVIRONMENT)),
    ebay_account_id: model.text(),
    fallback_store_category_id: model.text().nullable(),
  })
  .indexes([
    { name: "IDX_ebay_category_assignment_settings_scope", on: ["environment", "ebay_account_id"], unique: true, where: "deleted_at is null" },
  ])

export default EbayCategoryAssignmentSettings
