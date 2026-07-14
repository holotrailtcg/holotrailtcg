import { VERIFIED_PULSE_ROWS } from "../../__fixtures__/pulse-rows"
import { resolveCondition } from "../resolve-condition"

describe("condition resolution", () => {
  it("defaults a missing condition to Near Mint with provenance", () => {
    expect(resolveCondition()).toEqual({ condition: "NEAR_MINT", source: "DEFAULTED" })
  })

  it("reads Lightly Played from the verified Product ID suffix", () => {
    expect(resolveCondition(null, VERIFIED_PULSE_ROWS.lightlyPlayedSuffix.productId)).toEqual({
      condition: "LIGHTLY_PLAYED", source: "EXPLICIT",
    })
  })

  it("rejects unknown and Mint conditions", () => {
    expect(() => resolveCondition("Mint")).toThrow("Unsupported card condition")
    expect(() => resolveCondition("Excellent")).toThrow("Unsupported card condition")
  })
})
