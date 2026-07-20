import { model } from "@medusajs/framework/utils"
import { EBAY_ENVIRONMENT } from "../types"

const EbayStoreCategoryAudit = model.define({ name: "EbayStoreCategoryAudit", tableName: "ebay_integration_store_category_audit" }, {
  id: model.id({ prefix: "ebstoreaudit" }).primaryKey(), environment: model.enum(Object.values(EBAY_ENVIRONMENT)),
  ebay_account_id: model.text(), actor_id: model.text(), action: model.text(), category_id: model.text().nullable(),
  correlation_id: model.text(), details: model.json().nullable(),
}).indexes([{ name: "IDX_ebay_store_category_audit_scope", on: ["environment", "ebay_account_id", "created_at"] }])
export default EbayStoreCategoryAudit
