import { model } from "@medusajs/framework/utils"
import { EBAY_ENVIRONMENT } from "../types"

const EbayOAuthState = model
  .define({ name: "EbayOAuthState", tableName: "ebay_integration_oauth_state" }, {
    id: model.id({ prefix: "ebstate" }).primaryKey(),
    environment: model.enum(Object.values(EBAY_ENVIRONMENT)),
    attempt_id: model.text(),
    state_hash: model.text(),
    initiating_actor_id: model.text(),
    redirect_intent: model.text().nullable(),
    expires_at: model.dateTime(),
    consumed_at: model.dateTime().nullable(),
  })
  .indexes([
    { name: "IDX_ebay_oauth_state_hash", on: ["state_hash"], unique: true, where: "deleted_at is null" },
    { name: "IDX_ebay_oauth_state_attempt", on: ["attempt_id"], unique: true, where: "deleted_at is null" },
    { name: "IDX_ebay_oauth_state_expiry", on: ["expires_at"], where: "consumed_at is null and deleted_at is null" },
    { name: "IDX_ebay_oauth_state_cleanup", on: ["created_at", "id"], where: "deleted_at is null" },
  ])
  .checks([{
    name: "CK_ebay_oauth_state_hash_format",
    expression: (columns) => `${columns.state_hash} ~ '^[a-f0-9]{64}$'`,
  }, {
    name: "CK_ebay_oauth_state_attempt_format",
    expression: (columns) => `${columns.attempt_id} ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'`,
  }])

export default EbayOAuthState
