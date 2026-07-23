import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * Ambiguous-TCGdex-match review feature: adds the `AMBIGUOUS` outcome and a
 * `candidate_options` shortlist column to `trading_card_tcgdex_lookup_candidate`
 * — when the exact (set, local number) lookup finds nothing, a fallback
 * set-scoped search may turn up 1+ plausible cards, cached here for a
 * reviewer to pick from (see `resolveAmbiguousTcgdexLookupCandidate`) rather
 * than being silently discarded as a `NO_MATCH`. Also widens
 * `trading_card_audit_entry`'s action constraint for the new
 * `TCGDEX_AMBIGUOUS_CANDIDATE_RESOLVED` action that flow writes.
 *
 * `down()` never deletes rows already using `AMBIGUOUS`/`candidate_options`
 * or the new audit action — both represent real reviewer-facing state
 * (an unresolved shortlist, or a resolution's only audit trail) that a
 * rollback must not silently destroy.
 */
export class Migration20260723160000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" add column if not exists "candidate_options" jsonb null;`)
    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" drop constraint if exists "trading_card_tcgdex_lookup_candidate_match_outcome_check";`)
    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" add constraint "trading_card_tcgdex_lookup_candidate_match_outcome_check" check ("match_outcome" in ('MATCHED', 'AMBIGUOUS', 'NO_MATCH', 'UNRESOLVED_SET', 'IDENTITY_MISMATCH'));`)
    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" drop constraint if exists "ck_tcgdex_lookup_candidate_review_status_pair";`)
    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" add constraint "ck_tcgdex_lookup_candidate_review_status_pair"
      check (
        (match_outcome = 'MATCHED' and review_status is not null and enrichment is not null and candidate_options is null) or
        (match_outcome = 'AMBIGUOUS' and review_status is not null and enrichment is null and candidate_options is not null) or
        (match_outcome not in ('MATCHED', 'AMBIGUOUS') and review_status is null and enrichment is null and candidate_options is null)
      );`)

    this.addSql(`alter table "trading_card_audit_entry" drop constraint if exists "CK_trading_card_audit_action";`)
    this.addSql(`alter table "trading_card_audit_entry" add constraint "CK_trading_card_audit_action"
      check (action in (
        'CANONICAL_IDENTITY_CHANGED','CONDITION_CHANGED','FINISH_CHANGED','SPECIAL_TREATMENT_CHANGED','PRICE_LOCKED','PRICE_UNLOCKED',
        'EXTERNAL_REFERENCE_ADDED','EXTERNAL_REFERENCE_CHANGED','EXTERNAL_REFERENCE_REMOVED','TCGDEX_ENRICHMENT_RECORDED',
        'TCGDEX_ENRICHMENT_SUPERSEDED','TCGDEX_ENRICHMENT_APPROVED','TCGDEX_ENRICHMENT_REJECTED','TCGDEX_ENRICHMENT_APPLIED',
        'TCGDEX_MANUAL_REFERENCE_RECORDED','IMAGE_UPLOAD_REQUESTED','IMAGE_UPLOAD_CONFIRMED','IMAGE_UPLOAD_REJECTED',
        'IMAGE_UPLOAD_EXPIRED','IMAGE_DUPLICATE_DETECTED','IMAGE_REORDERED','IMAGE_FOCAL_CHANGED','IMAGE_ARCHIVED','IMAGE_RESTORED',
        'TCGDEX_LOOKUP_RETRIED','TCGDEX_MANUAL_REFERENCE_REVERTED','TCGDEX_MANUAL_REFERENCE_COMPENSATION_SKIPPED_STALE',
        'TCGDEX_MANUAL_REFERENCE_COMPENSATION_FAILED','TCGDEX_AMBIGUOUS_CANDIDATE_RESOLVED'
      ));`)
  }

  override async down(): Promise<void> {
    this.addSql(`
      do $$
      declare
        blocking_count integer;
      begin
        select count(*) into blocking_count
        from "trading_card_tcgdex_lookup_candidate"
        where match_outcome = 'AMBIGUOUS' or candidate_options is not null;

        if blocking_count > 0 then
          raise exception 'Migration20260723160000: % row(s) already use AMBIGUOUS/candidate_options, which this rollback would make invalid against the narrower constraint. Refusing to delete reviewer-facing shortlist state. Resolve manually first (e.g. do not roll back this migration).', blocking_count;
        end if;
      end $$;
    `)
    this.addSql(`
      do $$
      declare
        blocking_count integer;
      begin
        select count(*) into blocking_count
        from "trading_card_audit_entry"
        where action = 'TCGDEX_AMBIGUOUS_CANDIDATE_RESOLVED';

        if blocking_count > 0 then
          raise exception 'Migration20260723160000: % audit row(s) already use TCGDEX_AMBIGUOUS_CANDIDATE_RESOLVED. Refusing to delete append-only audit history. Resolve manually first (e.g. do not roll back this migration).', blocking_count;
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
        'TCGDEX_LOOKUP_RETRIED','TCGDEX_MANUAL_REFERENCE_REVERTED','TCGDEX_MANUAL_REFERENCE_COMPENSATION_SKIPPED_STALE',
        'TCGDEX_MANUAL_REFERENCE_COMPENSATION_FAILED'
      ));`)

    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" drop constraint if exists "ck_tcgdex_lookup_candidate_review_status_pair";`)
    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" add constraint "ck_tcgdex_lookup_candidate_review_status_pair"
      check (
        (match_outcome = 'MATCHED' and review_status is not null and enrichment is not null) or
        (match_outcome <> 'MATCHED' and review_status is null and enrichment is null)
      );`)
    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" drop constraint if exists "trading_card_tcgdex_lookup_candidate_match_outcome_check";`)
    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" add constraint "trading_card_tcgdex_lookup_candidate_match_outcome_check" check ("match_outcome" in ('MATCHED', 'NO_MATCH', 'UNRESOLVED_SET', 'IDENTITY_MISMATCH'));`)
    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" drop column if exists "candidate_options";`)
  }
}
