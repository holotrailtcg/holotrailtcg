import { candidateTcgdexSetIds } from "../suggest-set-mapping"

describe("candidateTcgdexSetIds", () => {
  it("returns just the literal code when no pattern applies", () => {
    expect(candidateTcgdexSetIds("swsh10", "EN")).toEqual(["swsh10"])
  })

  it("adds a stripped-suffix candidate for Japanese codes", () => {
    expect(candidateTcgdexSetIds("s8b_jp", "JA")).toEqual(["s8b_jp", "s8b"])
  })

  it("does not strip the Japanese suffix pattern for other languages", () => {
    expect(candidateTcgdexSetIds("s8b_jp", "EN")).toEqual(["s8b_jp"])
  })

  it("adds a pt-to-dot candidate for English codes", () => {
    expect(candidateTcgdexSetIds("swsh4pt5", "EN")).toEqual(["swsh4pt5", "swsh4.5"])
  })

  it("does not apply the pt-to-dot pattern for other languages", () => {
    expect(candidateTcgdexSetIds("me2pt5", "JA")).toEqual(["me2pt5"])
  })

  it("returns no candidates for a blank code", () => {
    expect(candidateTcgdexSetIds("   ", "EN")).toEqual([])
  })

  it("offers only the literal code for Chinese, since no pattern is derivable", () => {
    expect(candidateTcgdexSetIds("cbb2_scn", "ZH")).toEqual(["cbb2_scn"])
  })
})
