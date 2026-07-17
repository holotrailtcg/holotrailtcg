import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/** Review fixes for proposal/application state consistency on both fresh and already-migrated Stage 5B.2 databases. */
export class Migration20260718100500 extends Migration {
  override async up(): Promise<void> {
    // Stage 5B.1 exposed the review-status transition to APPLIED before an
    // authoritative holding/ledger application operation existed. Such rows
    // have no committed movement to replay, so carry them forward as reviewed
    // APPROVED proposals awaiting the new application path.
    this.addSql(`update "trading_card_inventory_proposal"
      set review_status = 'APPROVED', updated_at = now()
      where review_status = 'APPLIED' and applied_at is null and applied_transaction_id is null and applied_holding_id is null;`)

    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      drop constraint if exists "CK_tci_proposal_applied_consistency";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      add constraint "CK_tci_proposal_applied_consistency" check (
        (review_status = 'APPLIED' and applied_at is not null and applied_transaction_id is not null and applied_holding_id is not null
          and application_idempotency_key is not null and medusa_sync_status in ('PENDING', 'SYNCED', 'FAILED')) or
        (review_status <> 'APPLIED' and applied_at is null and applied_transaction_id is null and applied_holding_id is null
          and application_idempotency_key is null and medusa_sync_status = 'NOT_APPLICABLE')
      );`)

    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      drop constraint if exists "CK_tci_proposal_medusa_attempt_token_scope";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      add constraint "CK_tci_proposal_medusa_attempt_token_scope"
      check (medusa_sync_attempt_token is null or (review_status = 'APPLIED' and medusa_sync_status = 'PENDING'));`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      drop constraint if exists "CK_tci_proposal_medusa_attempt_token_scope";`)
    this.addSql(`alter table if exists "trading_card_inventory_proposal"
      drop constraint if exists "CK_tci_proposal_applied_consistency";`)
    this.addSql(`do $$ begin
      if exists (select 1 from information_schema.columns
        where table_name = 'trading_card_inventory_proposal' and column_name = 'applied_at') then
        alter table "trading_card_inventory_proposal"
          add constraint "CK_tci_proposal_applied_consistency"
          check (review_status <> 'APPLIED' or
            (applied_at is not null and applied_transaction_id is not null and applied_holding_id is not null));
      end if;
    end $$;`)
  }
}
