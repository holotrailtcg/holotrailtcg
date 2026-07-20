import { model } from "@medusajs/framework/utils"
import EbayConnection from "./ebay-connection"
import { EBAY_ENVIRONMENT } from "../types"

const EbayConnectionAudit = model
  .define({ name: "EbayConnectionAudit", tableName: "ebay_integration_connection_audit" }, {
    id: model.id({ prefix: "ebaudit" }).primaryKey(),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- same custom module; Medusa ESLint 2.16 misclassifies same-module relative imports on Windows.
    connection: model.belongsTo(() => EbayConnection).nullable(),
    environment: model.enum(Object.values(EBAY_ENVIRONMENT)),
    actor_id: model.text().nullable(),
    action: model.text(),
    previous_status: model.text().nullable(),
    resulting_status: model.text().nullable(),
    safe_outcome_category: model.text().nullable(),
    correlation_id: model.text(),
  })
  .indexes([
    { name: "IDX_ebay_connection_audit_connection", on: ["connection_id", "created_at"] },
    { name: "IDX_ebay_connection_audit_correlation", on: ["correlation_id"] },
  ])

export default EbayConnectionAudit
