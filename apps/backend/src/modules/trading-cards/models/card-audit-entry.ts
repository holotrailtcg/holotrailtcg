import { model } from "@medusajs/framework/utils"
import { AUDIT_ACTION, AUDIT_ENTITY_TYPE, RECORD_ORIGIN } from "../types"

const CardAuditEntry = model
  .define({ name: "CardAuditEntry", tableName: "trading_card_audit_entry" }, {
    id: model.id({ prefix: "tcaud" }).primaryKey(),
    actor: model.text(),
    entity_type: model.enum(Object.values(AUDIT_ENTITY_TYPE)),
    entity_id: model.text(),
    action: model.enum(Object.values(AUDIT_ACTION)),
    old_value: model.json().nullable(),
    new_value: model.json().nullable(),
    reason: model.text().nullable(),
    source: model.enum(Object.values(RECORD_ORIGIN)),
  })
  .indexes([{ name: "IDX_trading_card_audit_entity", on: ["entity_type", "entity_id"] }])

export default CardAuditEntry
