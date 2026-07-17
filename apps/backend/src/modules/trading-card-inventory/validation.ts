import { z } from "@medusajs/framework/zod"
import {
  INVENTORY_HOLDING_STATUS, INVENTORY_PROPOSAL_CHANGE_KIND, INVENTORY_PROPOSAL_REVIEW_STATUS, INVENTORY_PROVIDER,
  INVENTORY_PROVIDER_REFERENCE_TYPE, INVENTORY_SOURCE_LANGUAGE, INVENTORY_TRANSACTION_REASON, INVENTORY_NOTE_MAX_LENGTH,
  INVENTORY_SOURCE_NOTES_MAX_LENGTH, MEDUSA_SYNC_STATUS,
} from "./types"

export const idSchema = z.string().min(1)
export const actorSchema = z.string().min(1)
export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/)
export const nonNegativeIntSchema = z.number().int().min(0)

export const displayNameSchema = z.string().trim().min(1).max(255)
export const boundedNoteSchema = z.string().max(INVENTORY_NOTE_MAX_LENGTH)
export const boundedSourceNotesSchema = z.string().max(INVENTORY_SOURCE_NOTES_MAX_LENGTH)
export const boundedReferenceSchema = z.string().max(255)

export const auditContextSchema = z.object({
  actor: actorSchema,
  source: z.string().min(1),
  reason: z.string().max(INVENTORY_NOTE_MAX_LENGTH).nullish(),
})

export const createInventorySourceSchema = z.object({
  displayName: displayNameSchema,
  provider: z.enum(Object.values(INVENTORY_PROVIDER) as [string, ...string[]]),
  language: z.enum(Object.values(INVENTORY_SOURCE_LANGUAGE) as [string, ...string[]]).nullish(),
  defaultCurrencyCode: currencyCodeSchema.nullish(),
  defaultPricingProfileKey: z.string().max(255).nullish(),
  defaultStorefrontCategoryId: z.string().max(255).nullish(),
  notes: boundedSourceNotesSchema.nullish(),
})

export const renameInventorySourceSchema = z.object({ id: idSchema, displayName: displayNameSchema })

export const inventoryHoldingUpsertSchema = z.object({
  inventorySourceId: idSchema,
  tradingCardVariantId: idSchema,
  quantity: nonNegativeIntSchema,
  currencyCode: currencyCodeSchema.nullish(),
  unitAcquisitionCost: z.number().nonnegative().nullish(),
  unitMarketPrice: z.number().nonnegative().nullish(),
  unitSellingPrice: z.number().nonnegative().nullish(),
  providerReference: boundedReferenceSchema.nullish(),
})

export const holdingStatusSchema = z.enum(Object.values(INVENTORY_HOLDING_STATUS) as [string, ...string[]])

export const inventoryProposalCreateSchema = z.object({
  inventorySourceId: idSchema,
  inventorySnapshotId: idSchema.nullish(),
  tradingCardVariantId: idSchema.nullish(),
  providerReference: boundedReferenceSchema.nullish(),
  providerReferenceType: z.enum(Object.values(INVENTORY_PROVIDER_REFERENCE_TYPE) as [string, ...string[]]).nullish(),
  proposedQuantity: nonNegativeIntSchema.nullish(),
  previousQuantity: nonNegativeIntSchema.nullish(),
  currencyCode: currencyCodeSchema.nullish(),
  proposedUnitAcquisitionCost: z.number().nonnegative().nullish(),
  proposedUnitMarketPrice: z.number().nonnegative().nullish(),
  proposedUnitSellingPrice: z.number().nonnegative().nullish(),
  changeKind: z.enum(Object.values(INVENTORY_PROPOSAL_CHANGE_KIND) as [string, ...string[]]),
})

export const inventoryTransactionAppendSchema = z.object({
  tradingCardVariantId: idSchema,
  inventorySourceId: idSchema.nullish(),
  inventoryHoldingId: idSchema.nullish(),
  inventorySnapshotId: idSchema.nullish(),
  quantityBefore: nonNegativeIntSchema,
  quantityAfter: nonNegativeIntSchema,
  reason: z.enum(Object.values(INVENTORY_TRANSACTION_REASON) as [string, ...string[]]),
  originatingReference: boundedReferenceSchema.nullish(),
  idempotencyKey: z.string().max(255).nullish(),
  note: boundedNoteSchema.nullish(),
})

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
})

export const PROPOSAL_BATCH_MAX_SIZE = 200

export const proposalReviewTargetStatusSchema = z.enum([
  INVENTORY_PROPOSAL_REVIEW_STATUS.APPROVED, INVENTORY_PROPOSAL_REVIEW_STATUS.REJECTED,
] as [string, ...string[]])

export const reviewNoteSchema = z.string().max(500)

export const proposalReviewSchema = z.object({
  ids: z.array(idSchema).min(1).max(PROPOSAL_BATCH_MAX_SIZE),
  targetStatus: proposalReviewTargetStatusSchema,
  rejectionReason: boundedNoteSchema.nullish(),
  reviewNote: reviewNoteSchema.nullish(),
})

export const proposalApplyBatchSchema = z.object({
  ids: z.array(idSchema).min(1).max(PROPOSAL_BATCH_MAX_SIZE),
})

export const proposalApplySchema = z.object({
  id: idSchema,
  applicationIdempotencyKey: z.string().max(255).nullish(),
})

export const medusaSyncOutcomeSchema = z.enum([MEDUSA_SYNC_STATUS.SYNCED, MEDUSA_SYNC_STATUS.FAILED] as [string, ...string[]])

export const medusaSyncErrorSchema = z.object({
  category: z.string().min(1).max(64),
  message: z.string().min(1).max(500),
})

export const recordMedusaSyncResultSchema = z.object({
  proposalId: idSchema,
  attemptToken: z.string().min(1).max(64),
  outcome: medusaSyncOutcomeSchema,
  medusaInventoryItemId: z.string().max(255).nullish(),
  medusaStockLocationId: z.string().max(255).nullish(),
  error: medusaSyncErrorSchema.nullish(),
})
