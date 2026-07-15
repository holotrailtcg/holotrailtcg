import { canonicalSnapshot, snapshotFingerprint, tcgdexMatchResultSchema } from "../persistence-validation"

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
})
