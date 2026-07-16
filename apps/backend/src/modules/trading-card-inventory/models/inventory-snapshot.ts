import { model } from "@medusajs/framework/utils"
import InventorySource from "./inventory-source"
import { INVENTORY_SNAPSHOT_STATUS } from "../types"

const InventorySnapshot = model
  .define({ name: "InventorySnapshot", tableName: "trading_card_inventory_snapshot" }, {
    id: model.id({ prefix: "tcisnap" }).primaryKey(),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- Medusa ESLint 2.16 resolves same-module relative paths with Windows separators incorrectly.
    inventory_source: model.belongsTo(() => InventorySource),
    status: model.enum(Object.values(INVENTORY_SNAPSHOT_STATUS)).default(INVENTORY_SNAPSHOT_STATUS.DRAFT),
    sequence_number: model.number(),
    original_filename: model.text().nullable(),
    content_hash: model.text().nullable(),
    row_count: model.number().nullable(),
    created_by: model.text(),
    approved_by: model.text().nullable(),
    approved_at: model.dateTime().nullable(),
    rejected_by: model.text().nullable(),
    rejected_at: model.dateTime().nullable(),
    rejection_reason: model.text().nullable(),
    failed_at: model.dateTime().nullable(),
    failure_reason: model.text().nullable(),
  })
  .indexes([
    {
      name: "IDX_trading_card_inventory_snapshot_sequence",
      on: ["inventory_source_id", "sequence_number"],
      unique: true,
    },
    {
      name: "IDX_trading_card_inventory_snapshot_live_content_hash",
      on: ["inventory_source_id", "content_hash"],
      unique: true,
      where: "content_hash is not null and deleted_at is null and status not in ('REJECTED', 'FAILED')",
    },
    {
      name: "IDX_trading_card_inventory_snapshot_single_applying",
      on: ["inventory_source_id"],
      unique: true,
      where: "status = 'APPLYING' and deleted_at is null",
    },
  ])
  .checks([
    {
      name: "CK_trading_card_inventory_snapshot_filename_length",
      expression: (columns) => `length(${columns.original_filename}) <= 255`,
    },
    {
      name: "CK_trading_card_inventory_snapshot_row_count_non_negative",
      expression: (columns) => `${columns.row_count} is null or ${columns.row_count} >= 0`,
    },
    {
      name: "CK_trading_card_inventory_snapshot_rejection_length",
      expression: (columns) => `length(${columns.rejection_reason}) <= 500`,
    },
    {
      name: "CK_trading_card_inventory_snapshot_failure_length",
      expression: (columns) => `length(${columns.failure_reason}) <= 500`,
    },
    {
      name: "CK_trading_card_inventory_snapshot_approved_consistency",
      expression: (columns) =>
        `(${columns.approved_by} is null and ${columns.approved_at} is null) or ` +
        `(${columns.approved_by} is not null and ${columns.approved_at} is not null)`,
    },
    {
      name: "CK_trading_card_inventory_snapshot_rejected_consistency",
      expression: (columns) =>
        `(${columns.rejected_by} is null and ${columns.rejected_at} is null) or ` +
        `(${columns.rejected_by} is not null and ${columns.rejected_at} is not null)`,
    },
  ])

export default InventorySnapshot
