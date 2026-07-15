import { expiresAtFromNow } from "../r2-client"

describe("expiresAtFromNow", () => {
  it("adds the given number of minutes to the reference time", () => {
    const now = new Date("2026-01-01T00:00:00.000Z")
    expect(expiresAtFromNow(15, now)).toEqual(new Date("2026-01-01T00:15:00.000Z"))
  })

  it("supports fractional minutes", () => {
    const now = new Date("2026-01-01T00:00:00.000Z")
    expect(expiresAtFromNow(0.5, now)).toEqual(new Date("2026-01-01T00:00:30.000Z"))
  })

  it("defaults to the current time when no reference is given", () => {
    const before = Date.now()
    const result = expiresAtFromNow(15)
    const after = Date.now()
    expect(result.getTime()).toBeGreaterThanOrEqual(before + 15 * 60_000)
    expect(result.getTime()).toBeLessThanOrEqual(after + 15 * 60_000)
  })
})
