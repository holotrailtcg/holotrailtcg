import { canonicalDecimal, compareDecimals, maxDecimal, weightedAverage, type DecimalInput } from "./decimal"
import { MedusaError } from "@medusajs/framework/utils"
import { INVENTORY_PROPOSAL_CHANGE_KIND, type InventoryProposalChangeKind } from "../types"

export interface SnapshotEntryInput {
  providerReference: string
  providerReferenceType: string
  tradingCardVariantId?: string | null
  quantity: number
  currencyCode?: string | null
  unitAcquisitionCost?: DecimalInput | null
  unitMarketPrice?: DecimalInput | null
  unitSellingPrice?: DecimalInput | null
}

export interface GroupedSnapshotEntry {
  providerReference: string
  providerReferenceType: string
  tradingCardVariantId: string | null
  quantity: number
  currencyCode: string | null
  unitAcquisitionCost: string | null
  unitMarketPrice: string | null
  unitSellingPrice: string | null
  duplicateRowCount: number
  unresolvedReason: string | null
}

export interface ReconciliationProposal {
  reconciliationKey: string
  changeKind: InventoryProposalChangeKind
  providerReference: string
  providerReferenceType: string
  tradingCardVariantId: string | null
  previousQuantity: number
  proposedQuantity: number
  quantityDelta: number
  currencyCode: string | null
  previousUnitAcquisitionCost: string | null
  proposedUnitAcquisitionCost: string | null
  previousUnitMarketPrice: string | null
  proposedUnitMarketPrice: string | null
  previousUnitSellingPrice: string | null
  proposedUnitSellingPrice: string | null
  reason: string
  changedFields: string[]
  duplicateRowCount: number
  sellingPriceLocked: boolean
}

function groupKey(entry: SnapshotEntryInput): string {
  return `${entry.providerReferenceType}:${entry.providerReference}`
}

export function aggregateSnapshotEntries(entries: SnapshotEntryInput[]): Map<string, GroupedSnapshotEntry> {
  const buckets = new Map<string, SnapshotEntryInput[]>()
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.quantity) || entry.quantity < 0) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Snapshot quantity must be a non-negative safe integer")
    }
    const key = groupKey(entry)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(entry)
    else buckets.set(key, [entry])
  }

  return new Map([...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => {
    const variants = new Set(rows.map((row) => row.tradingCardVariantId).filter((id): id is string => Boolean(id)))
    const currencies = new Set(rows.map((row) => row.currencyCode).filter((code): code is string => Boolean(code)))
    const quantity = rows.reduce((sum, row) => sum + row.quantity, 0)
    const costRows = rows.filter((row) => row.unitAcquisitionCost !== null && row.unitAcquisitionCost !== undefined)
      .map((row) => ({ unitCost: row.unitAcquisitionCost as DecimalInput, quantity: row.quantity }))
    const unresolvedReason = variants.size !== 1
      ? (variants.size === 0 ? "No approved card variant match" : "Duplicate rows resolve to different card variants")
      : currencies.size > 1 ? "Duplicate rows use different currencies" : null
    const mixedCurrency = currencies.size > 1
    const grouped: GroupedSnapshotEntry = {
      providerReference: rows[0].providerReference,
      providerReferenceType: rows[0].providerReferenceType,
      tradingCardVariantId: unresolvedReason ? null : [...variants][0],
      quantity,
      currencyCode: currencies.size === 1 ? [...currencies][0] : null,
      unitAcquisitionCost: !mixedCurrency && costRows.length === rows.length ? weightedAverage(costRows) : null,
      unitMarketPrice: mixedCurrency ? null : maxDecimal(rows.map((row) => canonicalDecimal(row.unitMarketPrice))),
      unitSellingPrice: mixedCurrency ? null : maxDecimal(rows.map((row) => canonicalDecimal(row.unitSellingPrice))),
      duplicateRowCount: rows.length,
      unresolvedReason,
    }
    return [key, grouped]
  }))
}

function changedFields(previous: GroupedSnapshotEntry, current: GroupedSnapshotEntry): string[] {
  const changed: string[] = []
  if (previous.quantity !== current.quantity) changed.push("quantity")
  if (!compareDecimals(previous.unitAcquisitionCost, current.unitAcquisitionCost)) changed.push("acquisition_cost")
  if (!compareDecimals(previous.unitMarketPrice, current.unitMarketPrice)) changed.push("market_price")
  if (!compareDecimals(previous.unitSellingPrice, current.unitSellingPrice)) changed.push("selling_price")
  if (previous.currencyCode !== current.currencyCode) changed.push("currency")
  return changed
}

function primaryKind(changes: string[]): InventoryProposalChangeKind {
  if (changes.includes("quantity")) return INVENTORY_PROPOSAL_CHANGE_KIND.QUANTITY_CHANGE
  if (changes.includes("acquisition_cost")) return INVENTORY_PROPOSAL_CHANGE_KIND.COST_CHANGE
  if (changes.some((field) => field === "market_price" || field === "selling_price" || field === "currency")) {
    return INVENTORY_PROPOSAL_CHANGE_KIND.PRICE_CHANGE
  }
  return INVENTORY_PROPOSAL_CHANGE_KIND.NO_CHANGE
}

export function reconcileSnapshots(input: {
  previous: SnapshotEntryInput[]
  current: SnapshotEntryInput[]
  priceLockedVariantIds?: ReadonlySet<string>
}): ReconciliationProposal[] {
  const previous = aggregateSnapshotEntries(input.previous)
  const current = aggregateSnapshotEntries(input.current)
  const keys = [...new Set([...previous.keys(), ...current.keys()])].sort()
  return keys.map((key) => {
    const before = previous.get(key)
    const after = current.get(key)
    const effective = after ?? before!
    const unresolved = Boolean(after?.unresolvedReason ?? before?.unresolvedReason)
    const changes = !before ? ["new_holding"] : !after ? ["quantity"] : changedFields(before, after)
    const kind = unresolved
      ? INVENTORY_PROPOSAL_CHANGE_KIND.UNRESOLVED_VARIANT
      : !before ? INVENTORY_PROPOSAL_CHANGE_KIND.NEW_HOLDING : primaryKind(changes)
    const locked = Boolean(effective.tradingCardVariantId && input.priceLockedVariantIds?.has(effective.tradingCardVariantId))
    const previousQuantity = before?.quantity ?? 0
    const proposedQuantity = after?.quantity ?? 0
    return {
      reconciliationKey: key,
      changeKind: kind,
      providerReference: effective.providerReference,
      providerReferenceType: effective.providerReferenceType,
      tradingCardVariantId: effective.tradingCardVariantId,
      previousQuantity,
      proposedQuantity,
      quantityDelta: proposedQuantity - previousQuantity,
      currencyCode: after?.currencyCode ?? before?.currencyCode ?? null,
      previousUnitAcquisitionCost: before?.unitAcquisitionCost ?? null,
      proposedUnitAcquisitionCost: after?.unitAcquisitionCost ?? before?.unitAcquisitionCost ?? null,
      previousUnitMarketPrice: before?.unitMarketPrice ?? null,
      proposedUnitMarketPrice: after?.unitMarketPrice ?? before?.unitMarketPrice ?? null,
      previousUnitSellingPrice: before?.unitSellingPrice ?? null,
      proposedUnitSellingPrice: after?.unitSellingPrice ?? before?.unitSellingPrice ?? null,
      reason: after?.unresolvedReason ?? (locked && changes.includes("selling_price")
        ? "Selling price changed; the Stage 3 price lock remains authoritative"
        : !before ? "Holding exists only in the new snapshot"
          : !after ? "Holding is absent from the complete new snapshot"
            : changes.length === 0 ? "No compared inventory fields changed" : `Changed: ${changes.join(", ")}`),
      changedFields: changes,
      duplicateRowCount: after?.duplicateRowCount ?? before?.duplicateRowCount ?? 1,
      sellingPriceLocked: locked,
    }
  })
}
