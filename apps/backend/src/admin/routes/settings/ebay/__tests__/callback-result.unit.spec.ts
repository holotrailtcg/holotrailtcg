import { ebayCallbackResultMessage } from "../callback-result"

describe("eBay callback result copy", () => {
  it("describes a superseded attempt without provider details", () => {
    expect(ebayCallbackResultMessage("superseded")).toBe(
      "That eBay connection attempt was superseded by a newer action. No current connection was changed."
    )
  })

  it("never reflects an unknown or secret-shaped result", () => {
    const secret = "secret-code-sentinel"
    expect(ebayCallbackResultMessage(secret)).toBe("eBay connection failed safely. You can try again.")
    expect(ebayCallbackResultMessage(secret)).not.toContain(secret)
  })
})
