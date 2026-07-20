import { model } from "@medusajs/framework/utils"
import { EBAY_ENVIRONMENT } from "../types"

const EbayStoreCategoryImportPreview = model.define({
  name: "EbayStoreCategoryImportPreview",
  tableName: "ebay_integration_store_category_import_preview",
}, {
  id: model.id({ prefix: "ebstorepreview" }).primaryKey(),
  environment: model.enum(Object.values(EBAY_ENVIRONMENT)),
  ebay_account_id: model.text(),
  actor_id: model.text(),
  csv_sha256: model.text(),
  catalogue_fingerprint: model.text(),
  safe_summary: model.json(),
  expires_at: model.dateTime(),
  status: model.enum(["ACTIVE", "CONSUMED"]).default("ACTIVE"),
  consumed_at: model.dateTime().nullable(),
}).indexes([
  { name: "IDX_ebay_store_category_preview_actor", on: ["actor_id", "expires_at"] },
  { name: "IDX_ebay_store_category_preview_scope", on: ["environment", "ebay_account_id", "expires_at"] },
])

export default EbayStoreCategoryImportPreview
