import { callbackQuerySchema } from "../shared"

describe("eBay callback query validation", () => {
  const state = "a".repeat(43)

  it("accepts eBay's documented expires_in authorization-code lifetime", () => {
    expect(callbackQuerySchema.parse({ state, code: "code", expires_in: "299" })).toEqual({
      state, code: "code", expires_in: 299,
    })
  })

  it.each(["0", "3601", "1.5", "not-a-number"])("rejects an invalid expires_in value %s", (expires_in) => {
    expect(callbackQuerySchema.safeParse({ state, code: "code", expires_in }).success).toBe(false)
  })

  it("continues to reject undocumented callback parameters", () => {
    expect(callbackQuerySchema.safeParse({ state, code: "code", expires_in: "299", token: "unexpected" }).success).toBe(false)
  })
})
