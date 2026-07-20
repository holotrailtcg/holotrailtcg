import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260720100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "ebay_integration_connection" (
      "id" text not null, "environment" text check ("environment" in ('SANDBOX','PRODUCTION')) not null,
      "ebay_account_id" text null, "display_name" text null,
      "status" text check ("status" in ('CONNECTING','CONNECTED','DEGRADED','REFRESH_REQUIRED','DISCONNECTING','REVOKED','DISCONNECTED','ERROR')) not null,
      "current_attempt_id" text null, "credential_generation" text null,
      "refresh_operation_id" text null, "refresh_operation_started_at" timestamptz null,
      "refresh_token_ciphertext" text null, "refresh_token_iv" text null, "refresh_token_auth_tag" text null,
      "encryption_key_version" text null, "granted_scopes" jsonb not null default '[]',
      "access_token_expires_at" timestamptz null, "connected_at" timestamptz null, "connected_by" text null,
      "disconnected_at" timestamptz null, "disconnected_by" text null, "last_refresh_at" timestamptz null,
      "last_safe_error_category" text null, "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null,
      constraint "ebay_integration_connection_pkey" primary key ("id"),
      constraint "CK_ebay_connection_current_attempt_format" check (current_attempt_id is null or current_attempt_id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
      constraint "CK_ebay_connection_credential_generation_format" check (credential_generation is null or credential_generation ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
      constraint "CK_ebay_connection_refresh_operation" check (
        (refresh_operation_id is null and refresh_operation_started_at is null) or
        (refresh_operation_id is not null and refresh_operation_id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' and refresh_operation_started_at is not null)
      ),
      constraint "CK_ebay_connection_token_material" check (
        (refresh_token_ciphertext is null and refresh_token_iv is null and refresh_token_auth_tag is null and encryption_key_version is null) or
        (refresh_token_ciphertext is not null and refresh_token_iv is not null and refresh_token_auth_tag is not null and encryption_key_version is not null)
      ),
      constraint "CK_ebay_connection_token_generation" check (
        (refresh_token_ciphertext is null and credential_generation is null) or
        (refresh_token_ciphertext is not null and credential_generation is not null)
      ),
      constraint "CK_ebay_connection_refresh_reservation_status" check (
        (refresh_operation_id is null and refresh_operation_started_at is null) or
        (status in ('CONNECTED','DEGRADED') and refresh_token_ciphertext is not null
          and credential_generation is not null)
      ),
      constraint "CK_ebay_connection_lifecycle_state" check (
        (status = 'CONNECTING' and current_attempt_id is not null
          and refresh_operation_id is null and refresh_operation_started_at is null) or
        (status in ('CONNECTED','DEGRADED','REFRESH_REQUIRED') and current_attempt_id is not null
          and refresh_token_ciphertext is not null and credential_generation is not null) or
        (status = 'DISCONNECTING' and current_attempt_id is null
          and refresh_operation_id is null and refresh_operation_started_at is null) or
        (status in ('REVOKED','DISCONNECTED') and current_attempt_id is null
          and refresh_operation_id is null and refresh_operation_started_at is null
          and refresh_token_ciphertext is null and refresh_token_iv is null
          and refresh_token_auth_tag is null and encryption_key_version is null
          and credential_generation is null) or
        (status = 'ERROR' and refresh_operation_id is null and refresh_operation_started_at is null)
      ));`)
    this.addSql(`create unique index "IDX_ebay_connection_environment" on "ebay_integration_connection" ("environment") where deleted_at is null;`)
    this.addSql(`create unique index "IDX_ebay_connection_account" on "ebay_integration_connection" ("environment", "ebay_account_id") where ebay_account_id is not null and deleted_at is null;`)
    this.addSql(`create index "IDX_ebay_connection_deleted_at" on "ebay_integration_connection" ("deleted_at") where deleted_at is null;`)

    this.addSql(`create table "ebay_integration_oauth_state" (
      "id" text not null, "environment" text check ("environment" in ('SANDBOX','PRODUCTION')) not null,
      "attempt_id" text not null, "state_hash" text not null, "initiating_actor_id" text not null, "redirect_intent" text null,
      "expires_at" timestamptz not null, "consumed_at" timestamptz null,
      "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null,
      constraint "ebay_integration_oauth_state_pkey" primary key ("id"),
      constraint "CK_ebay_oauth_state_attempt_format" check (attempt_id ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
      constraint "CK_ebay_oauth_state_hash_format" check (state_hash ~ '^[a-f0-9]{64}$'));`)
    this.addSql(`create unique index "IDX_ebay_oauth_state_hash" on "ebay_integration_oauth_state" ("state_hash") where deleted_at is null;`)
    this.addSql(`create unique index "IDX_ebay_oauth_state_attempt" on "ebay_integration_oauth_state" ("attempt_id") where deleted_at is null;`)
    this.addSql(`create index "IDX_ebay_oauth_state_expiry" on "ebay_integration_oauth_state" ("expires_at") where consumed_at is null and deleted_at is null;`)
    this.addSql(`create index "IDX_ebay_oauth_state_cleanup" on "ebay_integration_oauth_state" ("created_at", "id") where deleted_at is null;`)
    this.addSql(`create index "IDX_ebay_oauth_state_deleted_at" on "ebay_integration_oauth_state" ("deleted_at") where deleted_at is null;`)

    this.addSql(`create table "ebay_integration_connection_audit" (
      "id" text not null, "connection_id" text null,
      "environment" text check ("environment" in ('SANDBOX','PRODUCTION')) not null,
      "actor_id" text null, "action" text not null, "previous_status" text null, "resulting_status" text null,
      "safe_outcome_category" text null, "correlation_id" text not null,
      "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null,
      constraint "ebay_integration_connection_audit_pkey" primary key ("id"),
      constraint "ebay_integration_connection_audit_connection_id_foreign" foreign key ("connection_id")
        references "ebay_integration_connection" ("id") on update cascade on delete restrict);`)
    this.addSql(`create index "IDX_ebay_connection_audit_connection" on "ebay_integration_connection_audit" ("connection_id", "created_at");`)
    this.addSql(`create index "IDX_ebay_connection_audit_correlation" on "ebay_integration_connection_audit" ("correlation_id");`)
    this.addSql(`create index "IDX_ebay_connection_audit_deleted_at" on "ebay_integration_connection_audit" ("deleted_at") where deleted_at is null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ebay_integration_connection_audit" cascade;`)
    this.addSql(`drop table if exists "ebay_integration_oauth_state" cascade;`)
    this.addSql(`drop table if exists "ebay_integration_connection" cascade;`)
  }
}
