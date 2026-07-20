import { model } from "@medusajs/framework/utils"
import { EBAY_ENVIRONMENT, EBAY_STORE_CATEGORY_SOURCE, EBAY_STORE_CATEGORY_STATUS } from "../types"

const EbayStoreCategory = model.define({ name: "EbayStoreCategory", tableName: "ebay_integration_store_category" }, {
  id: model.id({ prefix: "ebstorecat" }).primaryKey(),
  environment: model.enum(Object.values(EBAY_ENVIRONMENT)),
  ebay_account_id: model.text(),
  external_id: model.text(),
  name: model.text(),
  parent_external_id: model.text().nullable(),
  sibling_order: model.number(),
  level: model.number(),
  path: model.text(),
  status: model.enum(Object.values(EBAY_STORE_CATEGORY_STATUS)).default(EBAY_STORE_CATEGORY_STATUS.ACTIVE),
  source: model.enum(Object.values(EBAY_STORE_CATEGORY_SOURCE)),
  removed_at: model.dateTime().nullable(),
  removed_by: model.text().nullable(),
  removal_reason: model.text().nullable(),
}).indexes([
  { name: "IDX_ebay_store_category_identity", on: ["environment", "ebay_account_id", "external_id"], unique: true, where: "deleted_at is null" },
  { name: "IDX_ebay_store_category_tree", on: ["environment", "ebay_account_id", "parent_external_id", "sibling_order"], where: "deleted_at is null" },
]).checks([
  { name: "CK_ebay_store_category_level", expression: (c) => `${c.level} between 1 and 3` },
  { name: "CK_ebay_store_category_order", expression: (c) => `${c.sibling_order} >= 0` },
  { name: "CK_ebay_store_category_self_parent", expression: (c) => `${c.parent_external_id} is null or ${c.parent_external_id} <> ${c.external_id}` },
])

export default EbayStoreCategory
