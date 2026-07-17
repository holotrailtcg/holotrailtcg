import { model } from "@medusajs/framework/utils"
import InventorySource from "./inventory-source"
import InventorySnapshot from "./inventory-snapshot"
import {
  INVENTORY_PROPOSAL_CHANGE_KIND, INVENTORY_PROPOSAL_REVIEW_STATUS, INVENTORY_PROVIDER_REFERENCE_TYPE,
  MEDUSA_SYNC_STATUS,
} from "../types"

const InventoryProposal = model
  .define({ name: "InventoryProposal", tableName: "trading_card_inventory_proposal" }, {
    id: model.id({ prefix: "tciprop" }).primaryKey(),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- Medusa ESLint 2.16 resolves same-module relative paths with Windows separators incorrectly.
    inventory_source: model.belongsTo(() => InventorySource),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- Medusa ESLint 2.16 resolves same-module relative paths with Windows separators incorrectly.
    inventory_snapshot: model.belongsTo(() => InventorySnapshot).nullable(),
    baseline_snapshot_id: model.text().nullable(),
    reconciliation_key: model.text().nullable(),
    trading_card_variant_id: model.text().nullable(),
    provider_reference: model.text().nullable(),
    provider_reference_type: model.enum(Object.values(INVENTORY_PROVIDER_REFERENCE_TYPE)).nullable(),
    proposed_quantity: model.number().nullable(),
    previous_quantity: model.number().nullable(),
    quantity_delta: model.number().nullable(),
    currency_code: model.text().nullable(),
    proposed_unit_acquisition_cost: model.bigNumber().nullable(),
    previous_unit_acquisition_cost: model.bigNumber().nullable(),
    proposed_unit_market_price: model.bigNumber().nullable(),
    previous_unit_market_price: model.bigNumber().nullable(),
    proposed_unit_selling_price: model.bigNumber().nullable(),
    previous_unit_selling_price: model.bigNumber().nullable(),
    reconciliation_reason: model.text().nullable(),
    reconciliation_diagnostics: model.json().nullable(),
    compared_at: model.dateTime().nullable(),
    change_kind: model.enum(Object.values(INVENTORY_PROPOSAL_CHANGE_KIND)),
    review_status: model.enum(Object.values(INVENTORY_PROPOSAL_REVIEW_STATUS)).default(INVENTORY_PROPOSAL_REVIEW_STATUS.PENDING),
    resolved_by: model.text().nullable(),
    resolved_at: model.dateTime().nullable(),
    rejection_reason: model.text().nullable(),
    // Optional reviewer-supplied note, recorded alongside approve/reject.
    review_note: model.text().nullable(),
    // Stage 5B.2 application (authoritative local stock movement) tracking.
    applied_at: model.dateTime().nullable(),
    applied_transaction_id: model.text().nullable(),
    applied_holding_id: model.text().nullable(),
    application_idempotency_key: model.text().nullable(),
    /**
     * Medusa inventory sync state, independent of `review_status`. A proposal
     * reaching `review_status = APPLIED` means the authoritative local stock
     * movement (holding + ledger) has already committed — this column tracks
     * only whether that already-committed fact has also been reflected into
     * Medusa's own InventoryItem/StockLocation level. NOT_APPLICABLE covers
     * every proposal not yet locally applied. Never treat APPLIED+FAILED or
     * APPLIED+PENDING as "fully synchronised" in any UI/DTO.
     */
    medusa_sync_status: model.enum(Object.values(MEDUSA_SYNC_STATUS)).default(MEDUSA_SYNC_STATUS.NOT_APPLICABLE),
    medusa_inventory_item_id: model.text().nullable(),
    medusa_stock_location_id: model.text().nullable(),
    medusa_sync_attempted_at: model.dateTime().nullable(),
    medusa_sync_succeeded_at: model.dateTime().nullable(),
    medusa_sync_retry_count: model.number().default(0),
    // Minted fresh on every sync attempt; a result whose token no longer matches this value is stale and discarded.
    medusa_sync_attempt_token: model.text().nullable(),
    // Categorized, bounded, Admin-safe diagnostic only — never a raw Medusa exception or stack trace.
    medusa_sync_last_error: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_trading_card_inventory_proposal_pending_reference",
      on: ["inventory_snapshot_id", "provider_reference_type", "provider_reference"],
      unique: true,
      where: "review_status = 'PENDING' and provider_reference is not null and deleted_at is null",
    },
    { name: "IDX_trading_card_inventory_proposal_variant", on: ["trading_card_variant_id"] },
    { name: "IDX_tci_proposal_reconciliation_key", on: ["inventory_snapshot_id", "reconciliation_key"], unique: true,
      where: "reconciliation_key is not null and deleted_at is null" },
    { name: "IDX_tci_proposal_medusa_sync_status", on: ["medusa_sync_status"], where: "deleted_at is null" },
    {
      name: "IDX_tci_proposal_application_idempotency_key",
      on: ["application_idempotency_key"],
      unique: true,
      where: "application_idempotency_key is not null and deleted_at is null",
    },
  ])
  .checks([
    {
      name: "CK_tci_proposal_reason_length",
      expression: (columns) => `${columns.reconciliation_reason} is null or length(${columns.reconciliation_reason}) <= 500`,
    },
    {
      name: "CK_trading_card_inventory_proposal_quantities_non_negative",
      expression: (columns) =>
        `(${columns.proposed_quantity} is null or ${columns.proposed_quantity} >= 0) and ` +
        `(${columns.previous_quantity} is null or ${columns.previous_quantity} >= 0)`,
    },
    {
      name: "CK_trading_card_inventory_proposal_currency_format",
      expression: (columns) => `${columns.currency_code} is null or ${columns.currency_code} ~ '^[A-Z]{3}$'`,
    },
    {
      name: "CK_trading_card_inventory_proposal_amounts_require_currency",
      expression: (columns) =>
        `(${columns.proposed_unit_acquisition_cost} is null and ${columns.proposed_unit_market_price} is null and ${columns.proposed_unit_selling_price} is null) or ` +
        `${columns.currency_code} is not null`,
    },
    {
      name: "CK_trading_card_inventory_proposal_provider_reference_length",
      expression: (columns) => `length(${columns.provider_reference}) <= 255`,
    },
    {
      name: "CK_trading_card_inventory_proposal_rejection_length",
      expression: (columns) => `length(${columns.rejection_reason}) <= 500`,
    },
    {
      name: "CK_trading_card_inventory_proposal_resolved_consistency",
      expression: (columns) =>
        `(${columns.review_status} = 'PENDING' and ${columns.resolved_by} is null and ${columns.resolved_at} is null) or ` +
        `(${columns.review_status} <> 'PENDING' and ${columns.resolved_by} is not null and ${columns.resolved_at} is not null)`,
    },
    {
      name: "CK_trading_card_inventory_proposal_unresolved_variant_kind",
      expression: (columns) =>
        `${columns.trading_card_variant_id} is not null or ${columns.change_kind} = 'UNRESOLVED_VARIANT'`,
    },
    {
      name: "CK_tci_proposal_rejection_reason_scope",
      expression: (columns) =>
        `${columns.rejection_reason} is null or ${columns.review_status} = 'REJECTED'`,
    },
    {
      name: "CK_tci_proposal_review_note_length",
      expression: (columns) => `${columns.review_note} is null or length(${columns.review_note}) <= 500`,
    },
    {
      name: "CK_tci_proposal_applied_consistency",
      expression: (columns) =>
        `(${columns.review_status} = 'APPLIED' and ${columns.applied_at} is not null and ${columns.applied_transaction_id} is not null ` +
        `and ${columns.applied_holding_id} is not null and ${columns.application_idempotency_key} is not null ` +
        `and ${columns.medusa_sync_status} in ('PENDING', 'SYNCED', 'FAILED')) or ` +
        `(${columns.review_status} <> 'APPLIED' and ${columns.applied_at} is null and ${columns.applied_transaction_id} is null ` +
        `and ${columns.applied_holding_id} is null and ${columns.application_idempotency_key} is null ` +
        `and ${columns.medusa_sync_status} = 'NOT_APPLICABLE')`,
    },
    {
      name: "CK_tci_proposal_medusa_error_requires_failed",
      expression: (columns) => `${columns.medusa_sync_last_error} is null or ${columns.medusa_sync_status} = 'FAILED'`,
    },
    {
      name: "CK_tci_proposal_medusa_attempt_token_scope",
      expression: (columns) =>
        `${columns.medusa_sync_attempt_token} is null or ` +
        `(${columns.review_status} = 'APPLIED' and ${columns.medusa_sync_status} = 'PENDING')`,
    },
  ])

export default InventoryProposal
