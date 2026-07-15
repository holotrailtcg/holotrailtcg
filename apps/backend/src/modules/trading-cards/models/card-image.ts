import { model } from "@medusajs/framework/utils"
import TradingCardVariant from "./trading-card-variant"
import { IMAGE_STATUS } from "../types"

const CardImage = model
  .define({ name: "CardImage", tableName: "trading_card_image" }, {
    id: model.id({ prefix: "tcimg" }).primaryKey(),
    // eslint-disable-next-line @medusajs/link-no-cross-module-relationship -- Medusa ESLint 2.16 resolves same-module relative paths with Windows separators incorrectly.
    trading_card_variant: model.belongsTo(() => TradingCardVariant),
    status: model.enum(Object.values(IMAGE_STATUS)).default(IMAGE_STATUS.PENDING),
    staging_object_key: model.text().nullable(),
    final_object_key: model.text().nullable(),
    original_filename: model.text(),
    declared_mime_type: model.text(),
    declared_byte_size: model.number(),
    confirmed_mime_type: model.text().nullable(),
    confirmed_byte_size: model.number().nullable(),
    width: model.number().nullable(),
    height: model.number().nullable(),
    sha256_hash: model.text().nullable(),
    sort_order: model.number(),
    focal_x: model.float().default(0.5),
    focal_y: model.float().default(0.5),
    uploaded_by: model.text(),
    upload_expires_at: model.dateTime().nullable(),
    archived_at: model.dateTime().nullable(),
    archived_by: model.text().nullable(),
  })
  .indexes([
    {
      name: "IDX_trading_card_image_variant_id",
      on: ["trading_card_variant_id"],
    },
    {
      name: "IDX_trading_card_image_staging_key",
      on: ["staging_object_key"],
      unique: true,
      where: "staging_object_key is not null and deleted_at is null",
    },
    {
      name: "IDX_trading_card_image_final_key",
      on: ["final_object_key"],
      unique: true,
      where: "final_object_key is not null and deleted_at is null",
    },
    {
      name: "IDX_trading_card_image_sha256",
      on: ["sha256_hash"],
      where: "sha256_hash is not null and deleted_at is null",
    },
    {
      // Scoped to READY (not "not archived") because ordering/primary-image
      // semantics only apply to active, visible images; PENDING/DUPLICATE/
      // REJECTED/EXPIRED rows do not yet occupy a display slot.
      name: "IDX_trading_card_image_ready_sort_order",
      on: ["trading_card_variant_id", "sort_order"],
      unique: true,
      where: "status = 'READY' and deleted_at is null",
    },
  ])
  .checks([
    {
      name: "CK_trading_card_image_declared_size_positive",
      expression: (columns) => `${columns.declared_byte_size} > 0`,
    },
    {
      name: "CK_trading_card_image_confirmed_size_positive",
      expression: (columns) => `${columns.confirmed_byte_size} is null or ${columns.confirmed_byte_size} > 0`,
    },
    {
      name: "CK_trading_card_image_dimensions_positive",
      expression: (columns) =>
        `(${columns.width} is null or ${columns.width} > 0) and (${columns.height} is null or ${columns.height} > 0)`,
    },
    {
      name: "CK_trading_card_image_sort_order_non_negative",
      expression: (columns) => `${columns.sort_order} >= 0`,
    },
    {
      name: "CK_trading_card_image_focal_bounds",
      expression: (columns) =>
        `${columns.focal_x} between 0 and 1 and ${columns.focal_y} between 0 and 1`,
    },
    {
      name: "CK_trading_card_image_sha256_format",
      expression: (columns) => `${columns.sha256_hash} is null or ${columns.sha256_hash} ~ '^[a-f0-9]{64}$'`,
    },
    {
      name: "CK_trading_card_image_archived_consistency",
      expression: (columns) =>
        `(${columns.status} = 'ARCHIVED' and ${columns.archived_at} is not null and ${columns.archived_by} is not null) or ` +
        `(${columns.status} <> 'ARCHIVED' and ${columns.archived_at} is null and ${columns.archived_by} is null)`,
    },
  ])

export default CardImage
