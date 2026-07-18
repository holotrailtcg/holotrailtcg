import { useCallback, useRef, useState } from "react"

/**
 * Spreadsheet-style checkbox selection for a single-page table: a `Set` of
 * selected ids (never row indexes, so selection is stable across
 * refetch/sort as long as the same id is still present), an anchor id for
 * Shift-click ranges, and a header checkbox with select-all/clear-all and
 * indeterminate support.
 *
 * Generic over the row type and id type so it isn't proposals-specific.
 * `eligible(row)` decides whether a row can be selected at all — ineligible
 * rows are always skipped, both for direct clicks and for Shift-click
 * ranges.
 */
export function useRangeSelection<TRow, TId extends string = string>(
  getId: (row: TRow) => TId,
  eligible: (row: TRow) => boolean,
) {
  const [selected, setSelected] = useState<Set<TId>>(new Set())
  const anchorRef = useRef<TId | null>(null)

  const clear = useCallback(() => {
    setSelected(new Set())
    anchorRef.current = null
  }, [])

  /** Plain click (no Shift): toggle this row, and it becomes the new anchor either way. */
  const toggleOne = useCallback((row: TRow) => {
    if (!eligible(row)) return
    const id = getId(row)
    anchorRef.current = id
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [getId, eligible])

  /**
   * Shift-click: selects every eligible row between the current anchor and
   * `row` (inclusive), in either direction, using `visibleRows`'s current
   * order — never a stale/cached order. The anchor itself does not move.
   * Falls back to a plain toggle if there is no anchor yet (matches
   * standard spreadsheet/file-explorer behaviour for the very first click).
   */
  const toggleRange = useCallback((row: TRow, visibleRows: TRow[]) => {
    if (!eligible(row)) return
    const anchorId = anchorRef.current
    if (anchorId === null) {
      toggleOne(row)
      return
    }
    const targetId = getId(row)
    const anchorIndex = visibleRows.findIndex((candidate) => getId(candidate) === anchorId)
    const targetIndex = visibleRows.findIndex((candidate) => getId(candidate) === targetId)
    if (anchorIndex === -1 || targetIndex === -1) {
      toggleOne(row)
      return
    }
    const [start, end] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
    const rangeIds = visibleRows.slice(start, end + 1).filter(eligible).map(getId)
    setSelected((current) => new Set([...current, ...rangeIds]))
  }, [getId, eligible, toggleOne])

  /** Row click entry point — dispatches to `toggleRange` or `toggleOne` based on the Shift key. */
  const handleRowClick = useCallback((row: TRow, visibleRows: TRow[], event: { shiftKey: boolean }) => {
    if (event.shiftKey) {
      toggleRange(row, visibleRows)
    } else {
      toggleOne(row)
    }
  }, [toggleRange, toggleOne])

  /** Header checkbox: select all eligible visible rows, or clear them if all are already selected. */
  const toggleAllVisible = useCallback((visibleRows: TRow[]) => {
    const eligibleIds = visibleRows.filter(eligible).map(getId)
    setSelected((current) => {
      const allSelected = eligibleIds.length > 0 && eligibleIds.every((id) => current.has(id))
      if (allSelected) {
        const next = new Set(current)
        for (const id of eligibleIds) next.delete(id)
        return next
      }
      return new Set([...current, ...eligibleIds])
    })
  }, [getId, eligible])

  /**
   * Reconciles selection against the current page's rows: drops any
   * selected id that (a) is no longer present in `visibleRows`, matching
   * this table's single-page-at-a-time selection model, or (b) belongs to a
   * different eligibility "kind" than the row that was just clicked — the
   * existing kind-mismatch invariant this page already enforced before
   * range selection existed. `kindOf` is optional; omit it to only apply
   * rule (a).
   */
  const reconcile = useCallback((visibleRows: TRow[], kindOf?: (row: TRow) => unknown) => {
    setSelected((current) => {
      if (current.size === 0) return current
      const rowsById = new Map(visibleRows.map((row) => [getId(row), row] as const))
      let changed = false
      const next = new Set<TId>()
      let referenceKind: unknown
      let referenceKindSet = false
      for (const id of current) {
        const row = rowsById.get(id)
        if (!row) { changed = true; continue }
        if (kindOf) {
          const kind = kindOf(row)
          if (!referenceKindSet) { referenceKind = kind; referenceKindSet = true }
          if (kind !== referenceKind) { changed = true; continue }
        }
        next.add(id)
      }
      return changed ? next : current
    })
  }, [getId])

  const headerState = useCallback((visibleRows: TRow[]): "none" | "some" | "all" => {
    const eligibleIds = visibleRows.filter(eligible).map(getId)
    if (eligibleIds.length === 0) return "none"
    const selectedCount = eligibleIds.filter((id) => selected.has(id)).length
    if (selectedCount === 0) return "none"
    if (selectedCount === eligibleIds.length) return "all"
    return "some"
  }, [selected, getId, eligible])

  return { selected, clear, toggleOne, toggleRange, handleRowClick, toggleAllVisible, reconcile, headerState }
}
