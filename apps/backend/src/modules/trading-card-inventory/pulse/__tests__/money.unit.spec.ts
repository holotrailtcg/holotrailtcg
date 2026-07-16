import { parseMoneyField } from "../money"

describe("parseMoneyField", () => {
  it("treats blank as missing, not zero", () => {
    expect(parseMoneyField("")).toEqual({ status: "missing", canonical: null })
    expect(parseMoneyField("   ")).toEqual({ status: "missing", canonical: null })
    expect(parseMoneyField(undefined)).toEqual({ status: "missing", canonical: null })
  })

  it("treats £0.00 as a legitimate known zero", () => {
    expect(parseMoneyField("£0.00")).toEqual({ status: "zero", canonical: "0.00" })
  })

  it("strips a currency symbol and parses a normal value", () => {
    expect(parseMoneyField("£1.00")).toEqual({ status: "value", canonical: "1.00" })
    expect(parseMoneyField("£14.99")).toEqual({ status: "value", canonical: "14.99" })
  })

  it("rejects negative amounts unless explicitly allowed", () => {
    expect(parseMoneyField("£-0.05")).toEqual({ status: "invalid", canonical: null })
    expect(parseMoneyField("£-0.05", { allowNegative: true })).toEqual({ status: "value", canonical: "-0.05" })
  })

  it("rejects excessive decimal precision", () => {
    expect(parseMoneyField("£1.1234567")).toEqual({ status: "invalid", canonical: null })
    expect(parseMoneyField("£1.123456")).toEqual({ status: "value", canonical: "1.123456" })
  })

  it("rejects malformed or ambiguous values", () => {
    expect(parseMoneyField("N/A")).toEqual({ status: "invalid", canonical: null })
    expect(parseMoneyField("£1.00.00")).toEqual({ status: "invalid", canonical: null })
    expect(parseMoneyField("free")).toEqual({ status: "invalid", canonical: null })
  })

  it("strips thousands separators defensively", () => {
    expect(parseMoneyField("£1,234.50")).toEqual({ status: "value", canonical: "1234.50" })
  })
})
