import { TCGDEX_ERROR_CODE, TcgDexError } from "../errors"
import { equivalentCardNumbers, matchTcgdexCard, type TcgDexLookupClient } from "../matching"
import { TCGDEX_MATCH_CODE } from "../matching-types"
import { normalizeTcgdexCard, normalizeTcgdexRarity } from "../normalization"
import { PROTECTED_ENRICHMENT_FIELDS } from "../enrichment"
import type { TcgDexCard } from "../types"

const card = (overrides: Partial<TcgDexCard> = {}): TcgDexCard => ({
  category: "Pokemon", id: "sv06-66", localId: "066", name: "Example", set: { id: "sv06", name: "Set" },
  variants: { normal: true, reverse: true, holo: false, firstEdition: false }, ...overrides,
})
const clientFor = (value: TcgDexCard | Error) => {
  const client: TcgDexLookupClient = { getCardBySetAndLocalId: jest.fn(), getCardById: jest.fn() }
  ;(client.getCardBySetAndLocalId as jest.Mock).mockImplementation(async () => { if (value instanceof Error) throw value; return value })
  ;(client.getCardById as jest.Mock).mockImplementation(async () => { if (value instanceof Error) throw value; return value })
  return client
}

describe("TCGdex matching and normalization", () => {
  it.each(["EN", "JA", "ZH"] as const)("matches %s with a trusted set ID", async (language) => {
    const client = clientFor(card({ localId: "066" }))
    const result = await matchTcgdexCard({ language, setCode: "local-set", cardNumber: "066/196", cardName: "Different name", setIdentity: { tcgdexSetId: "sv06" } }, client)
    expect(result.code).toBe(TCGDEX_MATCH_CODE.MATCHED)
    expect(client.getCardBySetAndLocalId).toHaveBeenCalledWith(language, "sv06", "066/196")
  })

  it("does not request an unresolved set", async () => {
    const client = clientFor(card())
    await expect(matchTcgdexCard({ language: "EN", setCode: "local", cardNumber: "1" }, client)).resolves.toMatchObject({ code: "UNRESOLVED_SET" })
    expect(client.getCardBySetAndLocalId).not.toHaveBeenCalled()
  })

  it("classifies not-found separately and provider failures safely", async () => {
    const input = { language: "EN" as const, setCode: "local", cardNumber: "1", setIdentity: { tcgdexSetId: "sv06" } }
    await expect(matchTcgdexCard(input, clientFor(new TcgDexError({ code: "NOT_FOUND", operation: "x", message: "not found" })))).resolves.toMatchObject({ code: "NO_MATCH" })
    const error = new TcgDexError({ code: TCGDEX_ERROR_CODE.TIMEOUT, operation: "x", message: "safe" , attemptCount: 4 })
    await expect(matchTcgdexCard(input, clientFor(error))).resolves.toMatchObject({ code: "PROVIDER_ERROR", providerCode: "TIMEOUT", attemptCount: 4 })
  })

  it("rejects invalid input without requesting", async () => {
    const client = clientFor(card())
    await expect(matchTcgdexCard({ language: "EN", setCode: " ", cardNumber: "1" }, client)).resolves.toMatchObject({ code: "INVALID_LOCAL_IDENTITY" })
    await expect(matchTcgdexCard({ language: "FR" as never, setCode: "local", cardNumber: "1", setIdentity: { tcgdexSetId: "sv06" } }, client)).resolves.toMatchObject({ code: "INVALID_LOCAL_IDENTITY", field: "language" })
    expect(client.getCardBySetAndLocalId).not.toHaveBeenCalled()
  })

  it("checks returned identity and manual references", async () => {
    const client = clientFor(card({ id: "sv06-99", set: { id: "other", name: "Other" }, localId: "99" }))
    const result = await matchTcgdexCard({ language: "EN", setCode: "local", cardNumber: "066", setIdentity: { tcgdexSetId: "sv06" }, manualCardReference: { provider: "TCGDEX", providerIdentifier: "sv06-66" } }, client)
    expect(client.getCardById).toHaveBeenCalledWith("EN", "sv06-66")
    expect(client.getCardBySetAndLocalId).not.toHaveBeenCalled()
    expect(result.code).toBe("IDENTITY_MISMATCH")
  })

  it("normalizes supported number forms without stripping meaningful text", () => {
    expect(equivalentCardNumbers(" 066/196 ", "66/196")).toBe(true)
    expect(equivalentCardNumbers("066/196", "066")).toBe(true)
    expect(equivalentCardNumbers("0104/15", "104/15")).toBe(true)
    expect(equivalentCardNumbers("53/62", "53/61")).toBe(false)
    expect(equivalentCardNumbers("SV1V-008", "008")).toBe(false)
  })

  it("normalizes Pokemon, Trainer and Energy fields without commercial inference", () => {
    const pokemon = normalizeTcgdexCard(card({ category: "Pokemon", image: "https://img.example/card.png", rarity: "Common", dexId: [133], types: ["Colorless"] }))
    const trainer = normalizeTcgdexCard(card({ category: "Trainer", image: undefined, illustrator: undefined }))
    const energy = normalizeTcgdexCard(card({ category: "Energy", variants: { normal: false, reverse: true, holo: false, firstEdition: false } }))
    expect(pokemon.referenceArtworkUrl).toBe("https://img.example/card.png")
    expect(pokemon.pokedexNumbers).toEqual([133])
    expect(trainer.referenceArtworkUrl).toBeUndefined()
    expect(energy.variants.reverse).toBe(true)
    expect(normalizeTcgdexRarity("Unknown")).toEqual({ status: "UNMAPPED", providerValue: "Unknown" })
    expect(energy).not.toHaveProperty("condition")
    expect(energy).not.toHaveProperty("finish")
  })

  it("keeps protected commercial fields outside the enrichment proposal", () => {
    const proposal = normalizeTcgdexCard(card())
    for (const field of PROTECTED_ENRICHMENT_FIELDS) expect(proposal).not.toHaveProperty(field)
  })
})
