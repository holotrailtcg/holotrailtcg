import { TCGDEX_ERROR_CODE, TcgDexError } from "../errors"
import { matchesLocalIdentity, matchTcgdexCard } from "../matching"
import { TCGDEX_MATCH_CODE } from "../matching-types"
import { normalizeTcgdexCard, normalizeTcgdexRarity } from "../normalization"
import { PROTECTED_ENRICHMENT_FIELDS } from "../enrichment"
import type { TcgDexCard } from "../types"

const card = (overrides: Partial<TcgDexCard> = {}): TcgDexCard => ({
  category: "Pokemon", id: "sv06-66", localId: "066", name: "Example", set: { id: "sv06", name: "Set" },
  variants: { normal: true, reverse: true, holo: false, firstEdition: false }, ...overrides,
})
const clientFor = (value: TcgDexCard | Error) => {
  const client = { getCardBySetAndLocalId: jest.fn(), getCardById: jest.fn() }
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
    for (const code of [TCGDEX_ERROR_CODE.TIMEOUT, TCGDEX_ERROR_CODE.RATE_LIMITED, TCGDEX_ERROR_CODE.INVALID_RESPONSE]) {
      const error = new TcgDexError({ code, operation: "x", message: "provider payload must not leak", attemptCount: 4 })
      const result = await matchTcgdexCard(input, clientFor(error))
      expect(result).toMatchObject({ code: "PROVIDER_ERROR", providerCode: code, attemptCount: 4 })
      expect(result).not.toHaveProperty("message")
      expect(JSON.stringify(result)).not.toContain("provider payload")
    }
    await expect(matchTcgdexCard(input, clientFor(new Error("unexpected programmer failure")))).rejects.toThrow("unexpected programmer failure")
  })

  it("rejects invalid input without requesting", async () => {
    const client = clientFor(card())
    await expect(matchTcgdexCard({ language: "EN", setCode: " ", cardNumber: "1" }, client)).resolves.toMatchObject({ code: "INVALID_LOCAL_IDENTITY" })
    await expect(matchTcgdexCard({ language: "FR" as never, setCode: "local", cardNumber: "1", setIdentity: { tcgdexSetId: "sv06" } }, client)).resolves.toMatchObject({ code: "INVALID_LOCAL_IDENTITY", field: "language" })
    for (const cardNumber of ["", " ", "/", "//", "/196", "066/", "066//196", "\u0001", "\u007f"]) {
      await expect(matchTcgdexCard({ language: "EN", setCode: "local", cardNumber, setIdentity: { tcgdexSetId: "sv06" } }, client)).resolves.toMatchObject({ code: "INVALID_LOCAL_IDENTITY" })
    }
    expect(client.getCardBySetAndLocalId).not.toHaveBeenCalled()
  })

  it("rejects unsafe local card numbers before either lookup", async () => {
    for (const cardNumber of ["066?x", "066#fragment", "066 value", "TG 01", "066\t196", "066\n196"]) {
      const client = clientFor(card())
      const result = await matchTcgdexCard({ language: "EN", setCode: "local", cardNumber, setIdentity: { tcgdexSetId: "sv06" } }, client)
      expect(result).toMatchObject({ code: "INVALID_LOCAL_IDENTITY", field: "cardNumber" })
      expect(client.getCardBySetAndLocalId).not.toHaveBeenCalled()
      expect(client.getCardById).not.toHaveBeenCalled()
    }
  })

  it.each([
    ["EN", "066"], ["EN", "066/196"], ["EN", "066 / 196"],
    ["JA", "TG01"], ["ZH", "SVP001"],
  ] as const)("accepts supported %s local identifier %s", async (language, cardNumber) => {
    const client = clientFor(card({ localId: cardNumber.includes("/") ? "066" : cardNumber }))
    const result = await matchTcgdexCard({ language, setCode: "local", cardNumber, setIdentity: { tcgdexSetId: "sv06" } }, client)
    expect(result).toMatchObject({ code: "MATCHED", source: "AUTOMATIC" })
    expect(client.getCardBySetAndLocalId).toHaveBeenCalledTimes(1)
  })

  it("isolates a returned set mismatch", async () => {
    const client = clientFor(card({ set: { id: "other", name: "Other" } }))
    const result = await matchTcgdexCard({ language: "EN", setCode: "local", cardNumber: "066", setIdentity: { tcgdexSetId: "sv06" } }, client)
    expect(result.code).toBe("IDENTITY_MISMATCH")
  })

  it("checks manual references and skips automatic lookup", async () => {
    const client = clientFor(card())
    const result = await matchTcgdexCard({ language: "EN", setCode: "local", cardNumber: "066", setIdentity: { tcgdexSetId: "sv06" }, manualCardReference: { provider: "TCGDEX", providerIdentifier: "sv06-66" } }, client)
    expect(client.getCardById).toHaveBeenCalledWith("EN", "sv06-66")
    expect(client.getCardBySetAndLocalId).not.toHaveBeenCalled()
    expect(result).toMatchObject({ code: "MATCHED", source: "MANUAL" })
  })

  it("requires a trusted set before manual lookup", async () => {
    const client = clientFor(card())
    const result = await matchTcgdexCard({ language: "EN", setCode: "local", cardNumber: "066", manualCardReference: { provider: "TCGDEX", providerIdentifier: "sv06-66" } }, client)
    expect(result).toMatchObject({ code: "UNRESOLVED_SET", source: "MANUAL" })
    expect(client.getCardById).not.toHaveBeenCalled()
    expect(client.getCardBySetAndLocalId).not.toHaveBeenCalled()
  })

  it("rejects manual set conflicts before either lookup", async () => {
    const client = clientFor(card())
    const result = await matchTcgdexCard({ language: "EN", setCode: "local", cardNumber: "066", setIdentity: { tcgdexSetId: "sv06", externalReference: { provider: "TCGDEX", providerIdentifier: "other" } }, manualCardReference: { provider: "TCGDEX", providerIdentifier: "sv06-66" } }, client)
    expect(result).toMatchObject({ code: "INVALID_LOCAL_IDENTITY", source: "MANUAL" })
    expect(client.getCardById).not.toHaveBeenCalled()
    expect(client.getCardBySetAndLocalId).not.toHaveBeenCalled()
  })

  it("rejects manual cards from the wrong set or local ID", async () => {
    const wrongSet = clientFor(card({ set: { id: "other", name: "Other" } }))
    await expect(matchTcgdexCard({ language: "EN", setCode: "local", cardNumber: "066", setIdentity: { tcgdexSetId: "sv06" }, manualCardReference: { provider: "TCGDEX", providerIdentifier: "sv06-66" } }, wrongSet)).resolves.toMatchObject({ code: "IDENTITY_MISMATCH", source: "MANUAL" })
    expect(wrongSet.getCardBySetAndLocalId).not.toHaveBeenCalled()
    const wrongNumber = clientFor(card({ localId: "067" }))
    await expect(matchTcgdexCard({ language: "EN", setCode: "local", cardNumber: "066", setIdentity: { tcgdexSetId: "sv06" }, manualCardReference: { provider: "TCGDEX", providerIdentifier: "sv06-66" } }, wrongNumber)).resolves.toMatchObject({ code: "IDENTITY_MISMATCH", source: "MANUAL" })
    expect(wrongNumber.getCardBySetAndLocalId).not.toHaveBeenCalled()
  })

  it("rejects conflicting trusted set references without requesting", async () => {
    const client = clientFor(card())
    const base = { language: "EN" as const, setCode: "local", cardNumber: "066" }
    await expect(matchTcgdexCard({ ...base, setIdentity: { tcgdexSetId: "sv06", externalReference: { provider: "TCGDEX", providerIdentifier: "other" } } }, client)).resolves.toMatchObject({ code: "INVALID_LOCAL_IDENTITY", field: "reference" })
    await expect(matchTcgdexCard({ ...base, setIdentity: { tcgdexSetId: " sv06 ", externalReference: { provider: "TCGDEX", providerIdentifier: "sv06" } } }, client)).resolves.toMatchObject({ code: "MATCHED" })
    await expect(matchTcgdexCard({ ...base, setIdentity: { tcgdexSetId: "", externalReference: { provider: "TCGDEX", providerIdentifier: "sv06" } } }, client)).resolves.toMatchObject({ code: "INVALID_LOCAL_IDENTITY" })
    expect(client.getCardBySetAndLocalId).toHaveBeenCalledTimes(1)
  })

  it("matches card numbers directionally and preserves meaningful identifiers", () => {
    expect(matchesLocalIdentity("066/196", "066")).toBe(true)
    expect(matchesLocalIdentity("066/196", "66")).toBe(true)
    expect(matchesLocalIdentity("066", "066/999")).toBe(false)
    expect(matchesLocalIdentity("066/196", "066/999")).toBe(false)
    expect(matchesLocalIdentity("066/196", "067")).toBe(false)
    expect(matchesLocalIdentity("TG01", "TG01")).toBe(true)
    expect(matchesLocalIdentity("TG01", "1")).toBe(false)
    expect(matchesLocalIdentity("SVP001", "001")).toBe(false)
    expect(matchesLocalIdentity("001", "1")).toBe(true)
    expect(matchesLocalIdentity("008/078", "008")).toBe(true)
    expect(matchesLocalIdentity("0104/15", "0104")).toBe(true)
  })

  it("normalizes Pokemon, Trainer and Energy fields without commercial inference", () => {
    const pokemon = normalizeTcgdexCard(card({ category: "Pokemon", image: "https://img.example/card.png", rarity: "Common", dexId: [133], types: ["Colorless"] }))
    const trainer = normalizeTcgdexCard(card({ category: "Trainer", image: undefined, illustrator: undefined }))
    const energy = normalizeTcgdexCard(card({ category: "Energy", variants: { normal: false, reverse: true, holo: false, firstEdition: false, wPromo: true } }))
    expect(pokemon.referenceArtworkUrl).toBe("https://img.example/card.png/low.webp")
    expect(pokemon.pokedexNumbers).toEqual([133])
    expect(trainer.referenceArtworkUrl).toBeUndefined()
    expect(energy.variants).toEqual({ normal: false, reverse: true, holo: false, firstEdition: false })
    expect(normalizeTcgdexRarity(" cOmMoN ")).toEqual({ status: "MAPPED", providerValue: " cOmMoN ", rarity: "COMMON", iconKey: "common" })
    expect(normalizeTcgdexRarity("Unknown")).toEqual({ status: "UNMAPPED", providerValue: "Unknown" })
    expect(energy).not.toHaveProperty("condition")
    expect(energy).not.toHaveProperty("finish")
  })

  it("keeps protected commercial fields outside the enrichment proposal", () => {
    const proposal = normalizeTcgdexCard(card())
    for (const field of PROTECTED_ENRICHMENT_FIELDS) expect(proposal).not.toHaveProperty(field)
  })

  it("rejects malformed provider identifiers before lookup", async () => {
    for (const reference of ["sv 06", "sv06/1", "sv06?x", "sv06#fragment", "\u0001"]) {
      const client = clientFor(card())
      await expect(matchTcgdexCard({ language: "EN", setCode: "local", cardNumber: "066", setIdentity: { tcgdexSetId: reference } }, client)).resolves.toMatchObject({ code: "INVALID_LOCAL_IDENTITY" })
      expect(client.getCardBySetAndLocalId).not.toHaveBeenCalled()
    }
    for (const reference of ["sv06/66", "sv06?card", "sv 06-66"]) {
      const client = clientFor(card())
      await expect(matchTcgdexCard({ language: "EN", setCode: "local", cardNumber: "066", setIdentity: { tcgdexSetId: "sv06" }, manualCardReference: { provider: "TCGDEX", providerIdentifier: reference } }, client)).resolves.toMatchObject({ code: "INVALID_LOCAL_IDENTITY", source: "MANUAL" })
      expect(client.getCardById).not.toHaveBeenCalled()
      expect(client.getCardBySetAndLocalId).not.toHaveBeenCalled()
    }
  })

  it("exposes only normalized enrichment from a match", async () => {
    const client = clientFor(card({ variants: { normal: true, reverse: false, holo: true, firstEdition: false, wPromo: true } }))
    const result = await matchTcgdexCard({ language: "EN", setCode: "local", cardNumber: "066", setIdentity: { tcgdexSetId: "sv06" } }, client)
    expect(result.code).toBe("MATCHED")
    expect(result).not.toHaveProperty("card")
    if (result.code === "MATCHED") {
      expect(result.enrichment.variants).toEqual({ normal: true, reverse: false, holo: true, firstEdition: false })
      expect(result.enrichment).not.toHaveProperty("wPromo")
    }
  })
})
