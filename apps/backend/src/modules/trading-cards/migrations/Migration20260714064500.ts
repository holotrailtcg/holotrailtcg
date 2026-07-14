import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Medusa 2.17.2's `isList: false` link metadata performs a service-level
 * uniqueness check but its generated pivot schema only has a composite
 * primary key. These active-row indexes are the concurrency-safe, database
 * guarantee for Stage 3's two one-to-one links.
 *
 * On a brand-new database, run `medusa db:sync-links --execute-safe`
 * before `medusa db:migrate` so the generated pivot tables exist before this
 * deliberately separate additive migration is applied.
 */
export class Migration20260714064500 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tc_product_link_product_unique" ON "product_product_tradingcards_trading_card" ("product_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tc_product_link_card_unique" ON "product_product_tradingcards_trading_card" ("trading_card_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tc_product_variant_link_product_variant_unique" ON "product_product_variant_tradingcards_trading_card_variant" ("product_variant_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tc_product_variant_link_card_variant_unique" ON "product_product_variant_tradingcards_trading_card_variant" ("trading_card_variant_id") WHERE deleted_at IS NULL;`)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_tc_product_link_product_unique";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_tc_product_link_card_unique";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_tc_product_variant_link_product_variant_unique";`)
    this.addSql(`DROP INDEX IF EXISTS "IDX_tc_product_variant_link_card_variant_unique";`)
  }
}
