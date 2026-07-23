import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Stage 1 rematch-compensation remediation: widens
 * `trading_card_audit_entry`'s action check constraint for the rematch
 * compensation saga's audit actions. `TCGDEX_MANUAL_REFERENCE_REVERTED` was
 * already written by `compensateTrustedTcgdexCardReference` before this
 * migration (introduced without ever widening the constraint — a
 * pre-existing gap), and `TCGDEX_MANUAL_REFERENCE_COMPENSATION_SKIPPED_STALE`
 * / `TCGDEX_MANUAL_REFERENCE_COMPENSATION_FAILED` are new. Purely additive —
 * no existing row, table or column is touched.
 *
 * `down()` never deletes audit history to make room for the narrower
 * constraint: audit entries are append-only and are this module's only
 * record that a compensation ever ran, succeeded, or failed (see
 * `CardAuditEntry`'s update/delete methods, which are blocked entirely).
 * If any row already uses one of these actions, `down()` refuses outright —
 * an operator must resolve that (e.g. accept staying on the wider
 * constraint) rather than have a rollback silently destroy the only
 * evidence a rematch compensation ran.
 */
export class Migration20260723150000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "trading_card_audit_entry" drop constraint if exists "CK_trading_card_audit_action";`)
    this.addSql(`alter table "trading_card_audit_entry" add constraint "CK_trading_card_audit_action"
      check (action in (
        'CANONICAL_IDENTITY_CHANGED','CONDITION_CHANGED','FINISH_CHANGED','SPECIAL_TREATMENT_CHANGED','PRICE_LOCKED','PRICE_UNLOCKED',
        'EXTERNAL_REFERENCE_ADDED','EXTERNAL_REFERENCE_CHANGED','EXTERNAL_REFERENCE_REMOVED','TCGDEX_ENRICHMENT_RECORDED',
        'TCGDEX_ENRICHMENT_SUPERSEDED','TCGDEX_ENRICHMENT_APPROVED','TCGDEX_ENRICHMENT_REJECTED','TCGDEX_ENRICHMENT_APPLIED',
        'TCGDEX_MANUAL_REFERENCE_RECORDED','IMAGE_UPLOAD_REQUESTED','IMAGE_UPLOAD_CONFIRMED','IMAGE_UPLOAD_REJECTED',
        'IMAGE_UPLOAD_EXPIRED','IMAGE_DUPLICATE_DETECTED','IMAGE_REORDERED','IMAGE_FOCAL_CHANGED','IMAGE_ARCHIVED','IMAGE_RESTORED',
        'TCGDEX_LOOKUP_RETRIED','TCGDEX_MANUAL_REFERENCE_REVERTED','TCGDEX_MANUAL_REFERENCE_COMPENSATION_SKIPPED_STALE',
        'TCGDEX_MANUAL_REFERENCE_COMPENSATION_FAILED'
      ));`)
  }

  override async down(): Promise<void> {
    this.addSql(`
      do $$
      declare
        blocking_count integer;
      begin
        select count(*) into blocking_count
        from "trading_card_audit_entry"
        where action in (
          'TCGDEX_MANUAL_REFERENCE_REVERTED','TCGDEX_MANUAL_REFERENCE_COMPENSATION_SKIPPED_STALE','TCGDEX_MANUAL_REFERENCE_COMPENSATION_FAILED'
        );

        if blocking_count > 0 then
          raise exception 'Migration20260723150000: % audit row(s) already use a rematch-compensation action this rollback would make invalid against the narrower constraint. Refusing to delete append-only audit history. Resolve manually first (e.g. do not roll back this migration).', blocking_count;
        end if;
      end $$;
    `)
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
}
