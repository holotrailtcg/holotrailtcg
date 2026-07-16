import { model } from "@medusajs/framework/utils"
import { INVENTORY_AUDIT_ACTION, INVENTORY_AUDIT_ENTITY_TYPE, INVENTORY_RECORD_SOURCE } from "../types"

const InventoryAuditEntry = model
  .define({ name: "InventoryAuditEntry", tableName: "trading_card_inventory_audit_entry" }, {
    id: model.id({ prefix: "tciaud" }).primaryKey(),
    actor: model.text(),
    entity_type: model.enum(Object.values(INVENTORY_AUDIT_ENTITY_TYPE)),
    entity_id: model.text(),
    action: model.enum(Object.values(INVENTORY_AUDIT_ACTION)),
    old_value: model.json().nullable(),
    new_value: model.json().nullable(),
    reason: model.text().nullable(),
    source: model.enum(Object.values(INVENTORY_RECORD_SOURCE)),
  })
  .indexes([{ name: "IDX_trading_card_inventory_audit_entity", on: ["entity_type", "entity_id"] }])
  .checks([{
    name: "CK_trading_card_inventory_audit_reason_length",
    expression: (columns) => `length(${columns.reason}) <= 500`,
  }])

export default InventoryAuditEntry
