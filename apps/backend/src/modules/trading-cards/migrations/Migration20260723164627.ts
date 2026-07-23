import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260723164627 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_audit_entry" drop constraint if exists "trading_card_audit_entry_entity_type_check";`);
    this.addSql(`alter table if exists "trading_card_audit_entry" drop constraint if exists "trading_card_audit_entry_action_check";`);

    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" drop constraint if exists "trading_card_tcgdex_lookup_candidate_match_outcome_check";`);

    this.addSql(`alter table if exists "trading_card_audit_entry" add constraint "trading_card_audit_entry_entity_type_check" check("entity_type" in ('TRADING_CARD', 'TRADING_CARD_VARIANT', 'EXTERNAL_CARD_REFERENCE', 'ENRICHMENT_PROPOSAL', 'CARD_IMAGE', 'TCGDEX_LOOKUP_CANDIDATE'));`);
    this.addSql(`alter table if exists "trading_card_audit_entry" add constraint "trading_card_audit_entry_action_check" check("action" in ('CANONICAL_IDENTITY_CHANGED', 'CONDITION_CHANGED', 'FINISH_CHANGED', 'SPECIAL_TREATMENT_CHANGED', 'PRICE_LOCKED', 'PRICE_UNLOCKED', 'EXTERNAL_REFERENCE_ADDED', 'EXTERNAL_REFERENCE_CHANGED', 'EXTERNAL_REFERENCE_REMOVED', 'TCGDEX_ENRICHMENT_RECORDED', 'TCGDEX_ENRICHMENT_SUPERSEDED', 'TCGDEX_ENRICHMENT_APPROVED', 'TCGDEX_ENRICHMENT_REJECTED', 'TCGDEX_ENRICHMENT_APPLIED', 'TCGDEX_MANUAL_REFERENCE_RECORDED', 'IMAGE_UPLOAD_REQUESTED', 'IMAGE_UPLOAD_CONFIRMED', 'IMAGE_UPLOAD_REJECTED', 'IMAGE_UPLOAD_EXPIRED', 'IMAGE_DUPLICATE_DETECTED', 'IMAGE_REORDERED', 'IMAGE_FOCAL_CHANGED', 'IMAGE_ARCHIVED', 'IMAGE_RESTORED', 'TCGDEX_LOOKUP_RETRIED'));`);

    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" drop constraint if exists CK_tcgdex_lookup_candidate_review_status_pair;`);

    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" add column if not exists "candidate_options" jsonb null;`);
    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" add constraint "trading_card_tcgdex_lookup_candidate_match_outcome_check" check("match_outcome" in ('MATCHED', 'AMBIGUOUS', 'NO_MATCH', 'UNRESOLVED_SET', 'IDENTITY_MISMATCH'));`);
    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" add constraint CK_tcgdex_lookup_candidate_review_status_pair check((match_outcome = 'MATCHED' and review_status is not null and enrichment is not null and candidate_options is null) or (match_outcome = 'AMBIGUOUS' and review_status is not null and enrichment is null and candidate_options is not null) or (match_outcome not in ('MATCHED', 'AMBIGUOUS') and review_status is null and enrichment is null and candidate_options is null));`);

    this.addSql(`alter table if exists "trading_card" add column if not exists "illustrator" text null, add column if not exists "illustrator_confirmed" boolean not null default false;`);
    this.addSql(`alter table if exists "trading_card" add constraint CK_trading_card_illustrator_length check(length(illustrator) <= 255);`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_audit_entry" drop constraint if exists "trading_card_audit_entry_entity_type_check";`);
    this.addSql(`alter table if exists "trading_card_audit_entry" drop constraint if exists "trading_card_audit_entry_action_check";`);

    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" drop constraint if exists "trading_card_tcgdex_lookup_candidate_match_outcome_check";`);

    this.addSql(`alter table if exists "trading_card_audit_entry" add constraint "trading_card_audit_entry_entity_type_check" check("entity_type" in ('TRADING_CARD', 'TRADING_CARD_VARIANT', 'EXTERNAL_CARD_REFERENCE', 'ENRICHMENT_PROPOSAL', 'CARD_IMAGE'));`);
    this.addSql(`alter table if exists "trading_card_audit_entry" add constraint "trading_card_audit_entry_action_check" check("action" in ('CANONICAL_IDENTITY_CHANGED', 'CONDITION_CHANGED', 'FINISH_CHANGED', 'SPECIAL_TREATMENT_CHANGED', 'PRICE_LOCKED', 'PRICE_UNLOCKED', 'EXTERNAL_REFERENCE_ADDED', 'EXTERNAL_REFERENCE_CHANGED', 'EXTERNAL_REFERENCE_REMOVED', 'TCGDEX_ENRICHMENT_RECORDED', 'TCGDEX_ENRICHMENT_SUPERSEDED', 'TCGDEX_ENRICHMENT_APPROVED', 'TCGDEX_ENRICHMENT_REJECTED', 'TCGDEX_ENRICHMENT_APPLIED', 'TCGDEX_MANUAL_REFERENCE_RECORDED', 'IMAGE_UPLOAD_REQUESTED', 'IMAGE_UPLOAD_CONFIRMED', 'IMAGE_UPLOAD_REJECTED', 'IMAGE_UPLOAD_EXPIRED', 'IMAGE_DUPLICATE_DETECTED', 'IMAGE_REORDERED', 'IMAGE_FOCAL_CHANGED', 'IMAGE_ARCHIVED', 'IMAGE_RESTORED'));`);

    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" drop constraint if exists CK_tcgdex_lookup_candidate_review_status_pair;`);
    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" drop column if exists "candidate_options";`);

    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" add constraint "trading_card_tcgdex_lookup_candidate_match_outcome_check" check("match_outcome" in ('MATCHED', 'NO_MATCH', 'UNRESOLVED_SET', 'IDENTITY_MISMATCH'));`);
    this.addSql(`alter table if exists "trading_card_tcgdex_lookup_candidate" add constraint CK_tcgdex_lookup_candidate_review_status_pair check((match_outcome = 'MATCHED' and review_status is not null and enrichment is not null) or (match_outcome <> 'MATCHED' and review_status is null and enrichment is null));`);

    this.addSql(`alter table if exists "trading_card" drop constraint if exists CK_trading_card_illustrator_length;`);
    this.addSql(`alter table if exists "trading_card" drop column if exists "illustrator", drop column if exists "illustrator_confirmed";`);
  }

}
