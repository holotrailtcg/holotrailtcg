import { searchTcgdexSetCards } from "../search"
import type { TcgDexSetDetail } from "../types"

const setDetail: TcgDexSetDetail = {
  id: "swsh4pt5", name: "Shining Fates", serie: { id: "swsh", name: "Sword & Shield" },
  cards: [
    { id: "swsh4pt5-44", localId: "044", name: "Crobat V", image: "https://example.com/044.png" },
    { id: "swsh4pt5-45", localId: "045", name: "Crobat VMAX" },
    { id: "swsh4pt5-1", localId: "001", name: "Grookey" },
  ],
}

describe("searchTcgdexSetCards", () => {
  it("returns every card when the query is blank", () => {
    expect(searchTcgdexSetCards(setDetail, undefined)).toHaveLength(3)
    expect(searchTcgdexSetCards(setDetail, "")).toHaveLength(3)
  })

  it("filters case-insensitively by name substring", () => {
    const results = searchTcgdexSetCards(setDetail, "crobat")
    expect(results.map((r) => r.name)).toEqual(["Crobat V", "Crobat VMAX"])
  })

  it("matches an exact local card number", () => {
    const results = searchTcgdexSetCards(setDetail, "001")
    expect(results.map((r) => r.name)).toEqual(["Grookey"])
  })

  it("includes enough identifying data to distinguish similar cards", () => {
    const [result] = searchTcgdexSetCards(setDetail, "Crobat V")
    expect(result).toEqual({
      tcgdexSetId: "swsh4pt5", tcgdexCardId: "swsh4pt5-44", localId: "044",
      name: "Crobat V", image: "https://example.com/044.png", setName: "Shining Fates",
    })
  })

  it("returns an empty array for a set with no card list captured", () => {
    expect(searchTcgdexSetCards({ id: "x", name: "X", serie: { id: "s", name: "S" } }, "anything")).toEqual([])
  })
})
