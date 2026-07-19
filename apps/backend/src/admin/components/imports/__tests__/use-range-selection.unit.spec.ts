/**
 * @jest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react"
import { useRangeSelection } from "../use-range-selection"

interface Row { id: string; kind: "A" | "B" }

const row = (id: string, kind: "A" | "B" = "A"): Row => ({ id, kind })
const getId = (row: Row) => row.id
const eligible = (row: Row) => row.kind === "A"

function setup(rows: Row[]) {
  const hook = renderHook(() => useRangeSelection<Row>(getId, eligible))
  return { hook, rows }
}

describe("useRangeSelection", () => {
  it("selects one row on a plain click and sets it as the anchor", () => {
    const { hook, rows } = setup([row("1"), row("2"), row("3")])
    act(() => hook.result.current.toggleOne(rows[1]))
    expect([...hook.result.current.selected]).toEqual(["2"])
  })

  it("deselects an already-selected row on a second plain click", () => {
    const { hook, rows } = setup([row("1"), row("2")])
    act(() => hook.result.current.toggleOne(rows[0]))
    act(() => hook.result.current.toggleOne(rows[0]))
    expect(hook.result.current.selected.size).toBe(0)
  })

  it("Shift-click selects the full range downward from the anchor", () => {
    const rows = [row("1"), row("2"), row("3"), row("4"), row("5")]
    const { hook } = setup(rows)
    act(() => hook.result.current.toggleOne(rows[0])) // anchor = "1"
    act(() => hook.result.current.toggleRange(rows[3], rows)) // shift-click "4"
    expect([...hook.result.current.selected].sort()).toEqual(["1", "2", "3", "4"])
  })

  it("Shift-click selects the full range upward from the anchor", () => {
    const rows = [row("1"), row("2"), row("3"), row("4"), row("5")]
    const { hook } = setup(rows)
    act(() => hook.result.current.toggleOne(rows[3])) // anchor = "4"
    act(() => hook.result.current.toggleRange(rows[0], rows)) // shift-click "1"
    expect([...hook.result.current.selected].sort()).toEqual(["1", "2", "3", "4"])
  })

  it("skips ineligible rows inside a Shift-click range instead of selecting or erroring on them", () => {
    const rows = [row("1"), row("2", "B"), row("3"), row("4", "B"), row("5")]
    const { hook } = setup(rows)
    act(() => hook.result.current.toggleOne(rows[0])) // anchor = "1"
    act(() => hook.result.current.toggleRange(rows[4], rows)) // shift-click "5"
    expect([...hook.result.current.selected].sort()).toEqual(["1", "3", "5"])
  })

  it("computes the range using the current visible order passed in, not first-render order", () => {
    const original = [row("1"), row("2"), row("3")]
    const { hook } = setup(original)
    act(() => hook.result.current.toggleOne(original[0]))
    const reordered = [row("3"), row("2"), row("1")] // e.g. after a sort change
    act(() => hook.result.current.toggleRange(reordered[1], reordered)) // shift-click "2", now between "3" and "1" is just "2"
    expect([...hook.result.current.selected].sort()).toEqual(["1", "2"])
  })

  it("a plain click after a Shift-range resets the anchor to the newly-clicked row", () => {
    const rows = [row("1"), row("2"), row("3"), row("4")]
    const { hook } = setup(rows)
    act(() => hook.result.current.toggleOne(rows[0])) // anchor = "1"
    act(() => hook.result.current.toggleRange(rows[2], rows)) // range 1..3
    act(() => hook.result.current.toggleOne(rows[3])) // plain click "4" -> new anchor
    act(() => hook.result.current.toggleRange(rows[0], rows)) // shift-click "1" -> range should be 1..4, not just 1
    expect([...hook.result.current.selected].sort()).toEqual(["1", "2", "3", "4"])
  })

  it("falls back to a plain toggle when there is no anchor yet", () => {
    const rows = [row("1"), row("2")]
    const { hook } = setup(rows)
    act(() => hook.result.current.toggleRange(rows[1], rows))
    expect([...hook.result.current.selected]).toEqual(["2"])
  })

  it("clear() empties selection and resets the anchor (a following Shift-click behaves like the first click ever)", () => {
    const rows = [row("1"), row("2"), row("3")]
    const { hook } = setup(rows)
    act(() => hook.result.current.toggleOne(rows[0]))
    act(() => hook.result.current.clear())
    expect(hook.result.current.selected.size).toBe(0)
    act(() => hook.result.current.toggleRange(rows[2], rows))
    expect([...hook.result.current.selected]).toEqual(["3"])
  })

  describe("toggleAllVisible (header checkbox)", () => {
    it("selects every eligible visible row when none are selected", () => {
      const rows = [row("1"), row("2", "B"), row("3")]
      const { hook } = setup(rows)
      act(() => hook.result.current.toggleAllVisible(rows))
      expect([...hook.result.current.selected].sort()).toEqual(["1", "3"])
    })

    it("clears just the eligible visible rows when all of them are already selected", () => {
      const rows = [row("1"), row("2")]
      const { hook } = setup(rows)
      act(() => hook.result.current.toggleAllVisible(rows))
      act(() => hook.result.current.toggleAllVisible(rows))
      expect(hook.result.current.selected.size).toBe(0)
    })
  })

  describe("headerState", () => {
    it("is \"none\" when nothing eligible is selected", () => {
      const rows = [row("1"), row("2")]
      const { hook } = setup(rows)
      expect(hook.result.current.headerState(rows)).toBe("none")
    })

    it("is \"some\" when only part of the eligible rows are selected (indeterminate)", () => {
      const rows = [row("1"), row("2")]
      const { hook } = setup(rows)
      act(() => hook.result.current.toggleOne(rows[0]))
      expect(hook.result.current.headerState(rows)).toBe("some")
    })

    it("is \"all\" when every eligible row is selected", () => {
      const rows = [row("1"), row("2")]
      const { hook } = setup(rows)
      act(() => hook.result.current.toggleAllVisible(rows))
      expect(hook.result.current.headerState(rows)).toBe("all")
    })

    it("ignores ineligible rows when deciding the header state", () => {
      const rows = [row("1"), row("2", "B")]
      const { hook } = setup(rows)
      act(() => hook.result.current.toggleOne(rows[0]))
      expect(hook.result.current.headerState(rows)).toBe("all")
    })
  })

  describe("reconcile", () => {
    it("drops a selected id no longer present in the current visible rows", () => {
      const rows = [row("1"), row("2"), row("3")]
      const { hook } = setup(rows)
      act(() => { hook.result.current.toggleOne(rows[0]); hook.result.current.toggleOne(rows[1]) })
      act(() => hook.result.current.reconcile([rows[1], rows[2]]))
      expect([...hook.result.current.selected]).toEqual(["2"])
    })

    it("drops selections whose kind no longer matches the reference kind when kindOf is given", () => {
      const rows = [row("1", "A"), row("2", "A")]
      const { hook } = setup(rows)
      act(() => { hook.result.current.toggleOne(rows[0]); hook.result.current.toggleOne(rows[1]) })
      const mixedKindRows = [row("1", "A"), row("2", "B")]
      act(() => hook.result.current.reconcile(mixedKindRows, (r) => r.kind))
      expect([...hook.result.current.selected]).toEqual(["1"])
    })

    it("is a no-op (same Set reference) when nothing needs to change", () => {
      const rows = [row("1"), row("2")]
      const { hook } = setup(rows)
      act(() => hook.result.current.toggleOne(rows[0]))
      const before = hook.result.current.selected
      act(() => hook.result.current.reconcile(rows))
      expect(hook.result.current.selected).toBe(before)
    })
  })

  it("ignores a click/range on an ineligible row entirely", () => {
    const rows = [row("1", "B"), row("2")]
    const { hook } = setup(rows)
    act(() => hook.result.current.toggleOne(rows[0]))
    expect(hook.result.current.selected.size).toBe(0)
    act(() => hook.result.current.toggleRange(rows[0], rows))
    expect(hook.result.current.selected.size).toBe(0)
  })
})
