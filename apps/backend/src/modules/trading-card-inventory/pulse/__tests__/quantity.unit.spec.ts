import { parseQuantityField, MAX_ROW_QUANTITY } from "../quantity"

describe("parseQuantityField", () => {
  it("parses a valid non-negative integer, preserving zero", () => {
    expect(parseQuantityField("1")).toEqual({ status: "value", value: 1 })
    expect(parseQuantityField("0")).toEqual({ status: "value", value: 0 })
  })

  it("treats blank as missing", () => {
    expect(parseQuantityField("")).toEqual({ status: "missing", value: null })
  })

  it("rejects fractional values", () => {
    expect(parseQuantityField("1.5")).toEqual({ status: "invalid", value: null })
  })

  it("rejects NaN, infinity and stray symbols", () => {
    expect(parseQuantityField("NaN")).toEqual({ status: "invalid", value: null })
    expect(parseQuantityField("Infinity")).toEqual({ status: "invalid", value: null })
    expect(parseQuantityField("1e5")).toEqual({ status: "invalid", value: null })
    expect(parseQuantityField("-1")).toEqual({ status: "invalid", value: null })
    expect(parseQuantityField("1,000")).toEqual({ status: "invalid", value: null })
  })

  it("enforces the documented maximum", () => {
    expect(parseQuantityField(String(MAX_ROW_QUANTITY))).toEqual({ status: "value", value: MAX_ROW_QUANTITY })
    expect(parseQuantityField(String(MAX_ROW_QUANTITY + 1))).toEqual({ status: "invalid", value: null })
  })
})
