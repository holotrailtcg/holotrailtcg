import { rarityComparisonForm } from "../normalise-rarity"
import { iconKeyForRarity } from "../icon-key"

describe("rarity comparison", () => {
  it("normalises Unicode and accidental outer whitespace only", () => {
    expect(rarityComparisonForm("  Illustratio\u0301n  ")).toBe("Illustratión")
    expect(rarityComparisonForm("Double  Rare")).toBe("Double  Rare")
  })

  it("does not case-fold or translate", () => {
    expect(rarityComparisonForm("rare")).not.toBe(rarityComparisonForm("Rare"))
  })

  it("keeps confirmed no-rarity mapped to its real icon", () => {
    expect(iconKeyForRarity("NO_RARITY")).toBe("no-rarity")
  })
})
