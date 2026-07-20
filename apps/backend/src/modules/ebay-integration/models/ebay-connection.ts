import { model } from "@medusajs/framework/utils"
import { EBAY_CONNECTION_STATUS, EBAY_ENVIRONMENT } from "../types"

const EbayConnection = model
  .define({ name: "EbayConnection", tableName: "ebay_integration_connection" }, {
    id: model.id({ prefix: "ebconn" }).primaryKey(),
    environment: model.enum(Object.values(EBAY_ENVIRONMENT)),
    ebay_account_id: model.text().nullable(),
    display_name: model.text().nullable(),
    status: model.enum(Object.values(EBAY_CONNECTION_STATUS)),
    current_attempt_id: model.text().nullable(),
    credential_generation: model.text().nullable(),
    refresh_operation_id: model.text().nullable(),
    refresh_operation_started_at: model.dateTime().nullable(),
    refresh_token_ciphertext: model.text().nullable(),
    refresh_token_iv: model.text().nullable(),
    refresh_token_auth_tag: model.text().nullable(),
    encryption_key_version: model.text().nullable(),
    granted_scopes: model.json(),
    access_token_expires_at: model.dateTime().nullable(),
    connected_at: model.dateTime().nullable(),
    connected_by: model.text().nullable(),
    disconnected_at: model.dateTime().nullable(),
    disconnected_by: model.text().nullable(),
    last_refresh_at: model.dateTime().nullable(),
    last_safe_error_category: model.text().nullable(),
  })
  .indexes([
    { name: "IDX_ebay_connection_environment", on: ["environment"], unique: true, where: "deleted_at is null" },
    { name: "IDX_ebay_connection_account", on: ["environment", "ebay_account_id"], unique: true,
      where: "ebay_account_id is not null and deleted_at is null" },
  ])
  .checks([{
    name: "CK_ebay_connection_token_material",
    expression: (columns) =>
      `(${columns.refresh_token_ciphertext} is null and ${columns.refresh_token_iv} is null and ` +
      `${columns.refresh_token_auth_tag} is null and ${columns.encryption_key_version} is null) or ` +
      `(${columns.refresh_token_ciphertext} is not null and ${columns.refresh_token_iv} is not null and ` +
      `${columns.refresh_token_auth_tag} is not null and ${columns.encryption_key_version} is not null)`,
  }, {
    name: "CK_ebay_connection_token_generation",
    expression: (columns) =>
      `(${columns.refresh_token_ciphertext} is null and ${columns.credential_generation} is null) or ` +
      `(${columns.refresh_token_ciphertext} is not null and ${columns.credential_generation} is not null)`,
  }, {
    name: "CK_ebay_connection_current_attempt_format",
    expression: (columns) => `${columns.current_attempt_id} is null or ${columns.current_attempt_id} ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'`,
  }, {
    name: "CK_ebay_connection_credential_generation_format",
    expression: (columns) => `${columns.credential_generation} is null or ${columns.credential_generation} ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'`,
  }, {
    name: "CK_ebay_connection_refresh_operation",
    expression: (columns) =>
      `(${columns.refresh_operation_id} is null and ${columns.refresh_operation_started_at} is null) or ` +
      `(${columns.refresh_operation_id} is not null and ${columns.refresh_operation_id} ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' and ${columns.refresh_operation_started_at} is not null)`,
  }, {
    name: "CK_ebay_connection_refresh_reservation_status",
    expression: (columns) =>
      `(${columns.refresh_operation_id} is null and ${columns.refresh_operation_started_at} is null) or ` +
      `(${columns.status} in ('CONNECTED','DEGRADED') and ${columns.refresh_token_ciphertext} is not null and ${columns.credential_generation} is not null)`,
  }, {
    // PostgreSQL's migration is authoritative for this cross-column contract.
    name: "CK_ebay_connection_lifecycle_state",
    expression: (columns) =>
      `(${columns.status} = 'CONNECTING' and ${columns.current_attempt_id} is not null and ${columns.refresh_operation_id} is null and ${columns.refresh_operation_started_at} is null) or ` +
      `(${columns.status} in ('CONNECTED','DEGRADED','REFRESH_REQUIRED') and ${columns.current_attempt_id} is not null and ${columns.refresh_token_ciphertext} is not null and ${columns.credential_generation} is not null) or ` +
      `(${columns.status} = 'DISCONNECTING' and ${columns.current_attempt_id} is null and ${columns.refresh_operation_id} is null and ${columns.refresh_operation_started_at} is null) or ` +
      `(${columns.status} in ('REVOKED','DISCONNECTED') and ${columns.current_attempt_id} is null and ${columns.refresh_operation_id} is null and ${columns.refresh_operation_started_at} is null and ${columns.refresh_token_ciphertext} is null and ${columns.refresh_token_iv} is null and ${columns.refresh_token_auth_tag} is null and ${columns.encryption_key_version} is null and ${columns.credential_generation} is null) or ` +
      `(${columns.status} = 'ERROR' and ${columns.refresh_operation_id} is null and ${columns.refresh_operation_started_at} is null)`,
  }])

export default EbayConnection
