import { canonicalSnapshot, pulseProviderIdentifierSchema, snapshotFingerprint, tcgdexMatchResultSchema } from "../persistence-validation"

const snapshot = {
  provider: "TCGDEX", providerCardId: "sv1-001", providerSetId: "sv1", name: "Bulbasaur", localId: "001", category: "Pokemon",
  variants: { normal: true, reverse: false, holo: false, firstEdition: false },
  rarityCandidate: { status: "MAPPED", providerValue: "Common", rarity: "COMMON", iconKey: "common" },
  types: ["Grass"],
}

describe("TCGdex persistence validation", () => {
  it("canonicalizes object key order while preserving array order", () => {
    const reordered = {
      variants: { firstEdition: false, holo: false, reverse: false, normal: true },
      rarityCandidate: { iconKey: "common", rarity: "COMMON", providerValue: "Common", status: "MAPPED" },
      category: "Pokemon", localId: "001", name: "Bulbasaur", providerSetId: "sv1", providerCardId: "sv1-001", provider: "TCGDEX", types: ["Grass"],
    }
    expect(snapshotFingerprint(snapshot)).toBe(snapshotFingerprint(reordered))
    expect(snapshotFingerprint({ ...snapshot, types: ["Water"] })).not.toBe(snapshotFingerprint(snapshot))
    expect(snapshotFingerprint({ ...snapshot, types: ["Grass", "Water"] })).not.toBe(snapshotFingerprint({ ...snapshot, types: ["Water", "Grass"] }))
  })

  it("removes undefined optional values consistently and rejects invalid mapped rarity", () => {
    expect(canonicalSnapshot({ ...snapshot, illustrator: undefined })).toEqual(canonicalSnapshot(snapshot))
    expect(() => canonicalSnapshot({ ...snapshot, rarityCandidate: { status: "MAPPED", providerValue: "Unknown", rarity: "NOT_A_RARITY", iconKey: "common" } })).toThrow()
  })

  it("strips arbitrary diagnostic fields and rejects malformed provider errors", () => {
    const parsed = tcgdexMatchResultSchema.parse({ code: "NO_MATCH", source: "AUTOMATIC", reason: "NOT_FOUND", runtimeMessage: "secret" })
    expect(parsed).not.toHaveProperty("runtimeMessage")
    expect(() => tcgdexMatchResultSchema.parse({ code: "PROVIDER_ERROR", source: "AUTOMATIC", providerCode: "", attemptCount: 1 })).toThrow()
  })

  it("preserves provider rarity text while validating safe non-empty values", () => {
    const providerValue = "  cOmMoN "
    const decomposed = "Illustrat" + "i" + "\u0301" + "n"
    expect((canonicalSnapshot({ ...snapshot, rarityCandidate: { status: "MAPPED", providerValue, rarity: "COMMON", iconKey: "common" } }) as any).rarityCandidate.providerValue).toBe(providerValue)
    expect((canonicalSnapshot({ ...snapshot, rarityCandidate: { status: "MAPPED", providerValue: decomposed, rarity: "COMMON", iconKey: "common" } }) as any).rarityCandidate.providerValue).toBe(decomposed)
    for (const invalid of ["", "   ", "ok\u0001", "x".repeat(129)]) {
      expect(() => canonicalSnapshot({ ...snapshot, rarityCandidate: { status: "MAPPED", providerValue: invalid, rarity: "COMMON", iconKey: "common" } })).toThrow()
    }
    expect(() => canonicalSnapshot({ ...snapshot, unexpected: "field" })).toThrow()
    expect(() => canonicalSnapshot({ ...snapshot, rarityCandidate: { status: "MAPPED", providerValue: "Common", rarity: "COMMON", iconKey: "common", unexpected: true } })).toThrow()
  })

  it("accepts bounded Pulse references containing spaces but rejects URL/control delimiters", () => {
    expect(pulseProviderIdentifierSchema.parse(" card:sv1|066/196|Reverse Holo|null|null|null "))
      .toBe("card:sv1|066/196|Reverse Holo|null|null|null")
    for (const invalid of ["card:sv1|1?query", "card:sv1|1#fragment", "card:sv1|1\u0001", " "]) {
      expect(() => pulseProviderIdentifierSchema.parse(invalid)).toThrow()
    }
  })
})
