import { parsePhysicalCsvRows } from "../import-pulse-csv-snapshot"

/**
 * Stage 1 remediation regression tests: `csv-parse`'s record index
 * under-counts physical lines after a quoted multiline field, so the
 * previous `index + 1` line-number derivation silently drifted for every
 * row following one. `parsePhysicalCsvRows` instead derives the true
 * physical line from csv-parse's own cumulative `info.lines`.
 */
describe("parsePhysicalCsvRows", () => {
  it("assigns sequential physical line numbers for ordinary single-line rows", () => {
    const text = "h1,h2\nrow-a,1\nrow-b,2\nrow-c,3\n"
    const rows = parsePhysicalCsvRows(text)
    expect(rows.map((row) => row.lineNumber)).toEqual([1, 2, 3, 4])
  })

  it("does not lose a physical line for a blank line (skip_empty_lines: false)", () => {
    const text = "h1,h2\nrow-a,1\n\nrow-b,2\n"
    const rows = parsePhysicalCsvRows(text)
    // header=1, row-a=2, blank=3 (empty cells, still consumes a record slot), row-b=4
    expect(rows.map((row) => row.lineNumber)).toEqual([1, 2, 3, 4])
    expect(rows[2].cells.every((cell) => !cell || cell.trim() === "")).toBe(true)
  })

  it("assigns the STARTING physical line of a quoted multiline record, never its ending line", () => {
    const text = 'h1,h2,h3\nrow-a,1,x\n"multi\nline",2,y\nrow-b,3,z\n'
    const rows = parsePhysicalCsvRows(text)
    // header=1, row-a=2, the multiline record starts at physical line 3 (its quoted
    // field spans lines 3-4) — NOT line 4, which is where it ends.
    expect(rows.map((row) => row.lineNumber)).toEqual([1, 2, 3, 5])
    expect(rows[2].cells[0]).toBe("multi\nline")
  })

  it("correctly resumes numbering for the row immediately after a quoted multiline record", () => {
    const text = 'h1,h2\n"a\nb",1\nrow-after,2\nrow-after-2,3\n'
    const rows = parsePhysicalCsvRows(text)
    // header=1, multiline record starts at 2 (spans lines 2-3), row-after=4, row-after-2=5
    expect(rows.map((row) => row.lineNumber)).toEqual([1, 2, 4, 5])
  })

  it("still assigns a correct physical line to a malformed short row (relax_column_count)", () => {
    const text = "h1,h2,h3\nrow-a,1,x\nshort,only\nrow-b,2,z\n"
    const rows = parsePhysicalCsvRows(text)
    expect(rows.map((row) => row.lineNumber)).toEqual([1, 2, 3, 4])
    expect(rows[2].cells).toEqual(["short", "only"])
  })

  it("still assigns a correct physical line to a malformed long row (relax_column_count)", () => {
    const text = "h1,h2,h3\nrow-a,1,x\nlong,too,many,cols\nrow-b,2,z\n"
    const rows = parsePhysicalCsvRows(text)
    expect(rows.map((row) => row.lineNumber)).toEqual([1, 2, 3, 4])
    expect(rows[2].cells).toEqual(["long", "too", "many", "cols"])
  })

  it("handles two consecutive quoted multiline records without drifting", () => {
    const text = 'h1,h2\n"a\nb",1\n"c\nd\ne",2\nrow-after,3\n'
    const rows = parsePhysicalCsvRows(text)
    // header=1, first multiline (2 lines) starts at 2, second multiline (3 lines) starts at 4, row-after=7
    expect(rows.map((row) => row.lineNumber)).toEqual([1, 2, 4, 7])
  })
})
