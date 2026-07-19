import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260719171226 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "trading_card_tcgdex_lookup_candidate" ("id" text not null, "provider" text check ("provider" in ('TCGDEX', 'PULSE', 'EBAY', 'OTHER')) not null, "language" text check ("language" in ('EN', 'JA', 'ZH')) not null, "tcgdex_set_id" text not null, "card_number" text not null, "match_outcome" text check ("match_outcome" in ('MATCHED', 'NO_MATCH', 'UNRESOLVED_SET', 'IDENTITY_MISMATCH')) not null, "enrichment" jsonb null, "review_status" text check ("review_status" in ('PENDING', 'ACCEPTED', 'REJECTED')) null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "trading_card_tcgdex_lookup_candidate_pkey" primary key ("id"), constraint CK_tcgdex_lookup_candidate_review_status_pair check ((match_outcome = 'MATCHED' and review_status is not null and enrichment is not null) or (match_outcome <> 'MATCHED' and review_status is null and enrichment is null)));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_trading_card_tcgdex_lookup_candidate_deleted_at" ON "trading_card_tcgdex_lookup_candidate" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_trading_card_tcgdex_lookup_candidate_identity" ON "trading_card_tcgdex_lookup_candidate" ("provider", "language", "tcgdex_set_id", "card_number") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "trading_card_tcgdex_lookup_candidate" cascade;`);
  }

}
