import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Stage 1 (import identity & review corrections), TCGdex failed-lookup
 * retry: widens `trading_card_audit_entry`'s entity-type/action check
 * constraints for the new `TCGDEX_LOOKUP_CANDIDATE` entity type and
 * `TCGDEX_LOOKUP_RETRIED` action. Purely additive — no existing row,
 * table or column is touched.
 */
export class Migration20260723100000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "trading_card_audit_entry" drop constraint if exists "CK_trading_card_audit_entity_type";`)
    this.addSql(`alter table "trading_card_audit_entry" add constraint "CK_trading_card_audit_entity_type"
      check (entity_type in ('TRADING_CARD','TRADING_CARD_VARIANT','EXTERNAL_CARD_REFERENCE','ENRICHMENT_PROPOSAL','CARD_IMAGE','TCGDEX_LOOKUP_CANDIDATE'));`)
    this.addSql(`alter table "trading_card_audit_entry" drop constraint if exists "CK_trading_card_audit_action";`)
    this.addSql(`alter table "trading_card_audit_entry" add constraint "CK_trading_card_audit_action"
      check (action in (
        'CANONICAL_IDENTITY_CHANGED','CONDITION_CHANGED','FINISH_CHANGED','SPECIAL_TREATMENT_CHANGED','PRICE_LOCKED','PRICE_UNLOCKED',
        'EXTERNAL_REFERENCE_ADDED','EXTERNAL_REFERENCE_CHANGED','EXTERNAL_REFERENCE_REMOVED','TCGDEX_ENRICHMENT_RECORDED',
        'TCGDEX_ENRICHMENT_SUPERSEDED','TCGDEX_ENRICHMENT_APPROVED','TCGDEX_ENRICHMENT_REJECTED','TCGDEX_ENRICHMENT_APPLIED',
        'TCGDEX_MANUAL_REFERENCE_RECORDED','IMAGE_UPLOAD_REQUESTED','IMAGE_UPLOAD_CONFIRMED','IMAGE_UPLOAD_REJECTED',
        'IMAGE_UPLOAD_EXPIRED','IMAGE_DUPLICATE_DETECTED','IMAGE_REORDERED','IMAGE_FOCAL_CHANGED','IMAGE_ARCHIVED','IMAGE_RESTORED',
        'TCGDEX_LOOKUP_RETRIED'
      ));`)
  }

  override async down(): Promise<void> {
    this.addSql(`delete from "trading_card_audit_entry" where entity_type = 'TCGDEX_LOOKUP_CANDIDATE' or action = 'TCGDEX_LOOKUP_RETRIED';`)
    this.addSql(`alter table "trading_card_audit_entry" drop constraint if exists "CK_trading_card_audit_action";`)
    this.addSql(`alter table "trading_card_audit_entry" add constraint "CK_trading_card_audit_action"
      check (action in (
        'CANONICAL_IDENTITY_CHANGED','CONDITION_CHANGED','FINISH_CHANGED','SPECIAL_TREATMENT_CHANGED','PRICE_LOCKED','PRICE_UNLOCKED',
        'EXTERNAL_REFERENCE_ADDED','EXTERNAL_REFERENCE_CHANGED','EXTERNAL_REFERENCE_REMOVED','TCGDEX_ENRICHMENT_RECORDED',
        'TCGDEX_ENRICHMENT_SUPERSEDED','TCGDEX_ENRICHMENT_APPROVED','TCGDEX_ENRICHMENT_REJECTED','TCGDEX_ENRICHMENT_APPLIED',
        'TCGDEX_MANUAL_REFERENCE_RECORDED','IMAGE_UPLOAD_REQUESTED','IMAGE_UPLOAD_CONFIRMED','IMAGE_UPLOAD_REJECTED',
        'IMAGE_UPLOAD_EXPIRED','IMAGE_DUPLICATE_DETECTED','IMAGE_REORDERED','IMAGE_FOCAL_CHANGED','IMAGE_ARCHIVED','IMAGE_RESTORED'
      ));`)
    this.addSql(`alter table "trading_card_audit_entry" drop constraint if exists "CK_trading_card_audit_entity_type";`)
    this.addSql(`alter table "trading_card_audit_entry" add constraint "CK_trading_card_audit_entity_type"
      check (entity_type in ('TRADING_CARD','TRADING_CARD_VARIANT','EXTERNAL_CARD_REFERENCE','ENRICHMENT_PROPOSAL','CARD_IMAGE'));`)
  }
}
