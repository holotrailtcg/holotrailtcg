import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260713170838 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "newsletter_rate_limit_bucket" ("id" text not null, "request_key" text not null, "window_start" timestamptz not null, "count" integer not null default 0, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "newsletter_rate_limit_bucket_pkey" primary key ("id"), constraint CK_newsletter_rate_limit_bucket_count_non_negative check (count >= 0));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_newsletter_rate_limit_bucket_deleted_at" ON "newsletter_rate_limit_bucket" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_newsletter_rate_limit_bucket_request_key_window_start" ON "newsletter_rate_limit_bucket" ("request_key", "window_start") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_newsletter_rate_limit_bucket_window_start" ON "newsletter_rate_limit_bucket" ("window_start") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "newsletter_subscriber" ("id" text not null, "first_name" text not null, "email" text not null, "normalised_email" text not null, "status" text check ("status" in ('PENDING', 'CONFIRMED', 'UNSUBSCRIBED')) not null default 'PENDING', "consent_text_version" text not null, "consented_at" timestamptz not null, "source" text not null, "confirmation_token_hash" text null, "confirmation_token_expires_at" timestamptz null, "confirmed_at" timestamptz null, "unsubscribe_token_hash" text null, "unsubscribed_at" timestamptz null, "first_purchase_discount_eligible" boolean not null default false, "confirmation_email_last_sent_at" timestamptz null, "confirmation_send_state" text check ("confirmation_send_state" in ('NOT_SENT', 'SENT', 'FAILED')) not null default 'NOT_SENT', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "newsletter_subscriber_pkey" primary key ("id"), constraint CK_newsletter_subscriber_first_name_length check (length(first_name) <= 100), constraint CK_newsletter_subscriber_email_length check (length(email) <= 254), constraint CK_newsletter_subscriber_normalised_email_length check (length(normalised_email) <= 254), constraint CK_newsletter_subscriber_consent_text_version_length check (length(consent_text_version) <= 32), constraint CK_newsletter_subscriber_source_length check (length(source) <= 64));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_newsletter_subscriber_normalised_email" ON "newsletter_subscriber" ("normalised_email") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_newsletter_subscriber_status" ON "newsletter_subscriber" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_newsletter_subscriber_confirmation_token_hash" ON "newsletter_subscriber" ("confirmation_token_hash") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_newsletter_subscriber_unsubscribe_token_hash" ON "newsletter_subscriber" ("unsubscribe_token_hash") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_newsletter_subscriber_deleted_at" ON "newsletter_subscriber" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "newsletter_rate_limit_bucket" cascade;`);

    this.addSql(`drop table if exists "newsletter_subscriber" cascade;`);
  }

}
