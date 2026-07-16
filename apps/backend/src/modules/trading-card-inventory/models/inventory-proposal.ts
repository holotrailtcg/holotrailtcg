import { model } from "@medusajs/framework/utils"
import InventorySource from "./inventory-source"
import InventorySnapshot from "./inventory-snapshot"
import {
  INVENTORY_PROPOSAL_CHANGE_KIND, INVENTORY_PROPOSAL_REVIEW_STATUS, INVENTORY_PROVIDER_REFERENCE_TYPE,
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
        `(${columns.resolved_by} is null and ${columns.resolved_at} is null) or ` +
        `(${columns.resolved_by} is not null and ${columns.resolved_at} is not null)`,
    },
    {
      name: "CK_trading_card_inventory_proposal_unresolved_variant_kind",
      expression: (columns) =>
        `${columns.trading_card_variant_id} is not null or ${columns.change_kind} = 'UNRESOLVED_VARIANT'`,
    },
  ])

export default InventoryProposal
