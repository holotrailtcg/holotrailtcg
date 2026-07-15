import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../index"
import { Migration20260714150000 } from "../migrations/Migration20260714150000"
import { rarityComparisonForm } from "../rarity/normalise-rarity"

let pgConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
let service: any
const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

beforeAll(async () => {
  pgConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  const migration = new Migration20260714150000(undefined as never, undefined as never)
  await migration.up()
  for (const query of migration.getQueries()) await pgConnection.raw(String(query))
  migration.reset()
  medusaApp = await MedusaApp({ modulesConfig: { [TRADING_CARDS_MODULE]: { resolve: "./src/modules/trading-cards" } }, injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection }, cwd: process.cwd() })
  await medusaApp.onApplicationStart()
  service = medusaApp.modules[TRADING_CARDS_MODULE]
}, 60000)

afterAll(async () => {
  await (pgConnection as any)?.context?.destroy()
  await pgConnection?.destroy()
  await medusaApp?.onApplicationPrepareShutdown()
  await medusaApp?.onApplicationShutdown()
})

async function cardFixture() {
  const id = suffix()
  const set = await service.createCardSets({ game: "POKEMON", language: "EN", display_name: `Set ${id}`, provider_set_code: `set_${id}` })
  const card = await service.createTradingCards({ card_set_id: set.id, name: `Local ${id}`, search_name: `local ${id}`, card_number: "001", card_number_normalised: "001", origin: "MANUAL" })
  return { set, card }
}

function matched(name: string, rarity: "MAPPED" | "UNMAPPED" = "MAPPED") {
  return { code: "MATCHED", source: "AUTOMATIC", enrichment: {
    provider: "TCGDEX", providerCardId: `sv1-${name}`, providerSetId: `sv1-${name}`, name, localId: "001", category: "Pokemon",
    providerRarity: rarity === "MAPPED" ? "Common" : "Mystery", rarityCandidate: rarity === "MAPPED" ? { status: "MAPPED", providerValue: "Common", rarity: "COMMON", iconKey: "common" } : { status: "UNMAPPED", providerValue: "Mystery" },
    variants: { normal: true, reverse: false, holo: false, firstEdition: false },
  } } as const
}

function matchedWithRarity(name: string, providerValue: string, rarity: string, iconKey: string) {
  return { code: "MATCHED", source: "AUTOMATIC", enrichment: {
    provider: "TCGDEX", providerCardId: `sv1-${name}`, providerSetId: `sv1-${name}`, name, localId: "001", category: "Pokemon",
    providerRarity: providerValue, rarityCandidate: { status: "MAPPED", providerValue, rarity, iconKey },
    variants: { normal: true, reverse: false, holo: false, firstEdition: false },
  } } as const
}

const context = { actor: "stage4a3-test", source: "TCGDEX" as const }

describe("Stage 4A.3 TCGdex enrichment persistence", () => {
  it("records, deduplicates, supersedes, and transitions proposals", async () => {
    const { card } = await cardFixture()
    const token = suffix()
    const first = await service.recordTcgdexMatchResult({ ...context, tradingCardId: card.id, result: matched(`${token}-one`) })
    const repeated = await service.recordTcgdexMatchResult({ ...context, tradingCardId: card.id, result: matched(`${token}-one`) })
    expect(repeated.id).toBe(first.id)
    const changed = await service.recordTcgdexMatchResult({ ...context, tradingCardId: card.id, result: matched(`${token}-two`) })
    expect(changed.review_status).toBe("PENDING")
    expect((await service.retrieveTcgDexEnrichmentProposal(first.id)).review_status).toBe("SUPERSEDED")
    await expect(service.approveEnrichmentProposal({ ...context, proposalId: first.id })).rejects.toThrow()
    await expect(service.approveEnrichmentProposal({ ...context, proposalId: changed.id })).resolves.toMatchObject({ review_status: "APPROVED" })
    await expect(service.approveEnrichmentProposal({ ...context, proposalId: changed.id })).resolves.toMatchObject({ review_status: "APPROVED" })
    await expect(service.recordTcgdexMatchResult({ ...context, tradingCardId: card.id, result: matched(`${token}-three`) })).rejects.toThrow("approved")
  })

  it("records each diagnostic safely and deduplicates provider errors", async () => {
    const { card } = await cardFixture()
    const noMatch = await service.recordTcgdexMatchResult({ ...context, tradingCardId: card.id, result: { code: "NO_MATCH", source: "AUTOMATIC", reason: "NOT_FOUND" } })
    expect((await service.recordTcgdexMatchResult({ ...context, tradingCardId: card.id, result: { code: "NO_MATCH", source: "AUTOMATIC", reason: "NOT_FOUND" } })).id).toBe(noMatch.id)
    const error = { code: "PROVIDER_ERROR", source: "AUTOMATIC", providerCode: "TIMEOUT", attemptCount: 1 } as const
    const results = await Promise.all(Array.from({ length: 4 }, () => service.recordTcgdexMatchResult({ ...context, tradingCardId: card.id, result: error })))
    expect(new Set(results.map((value: any) => value.id)).size).toBe(1)
    await expect(service.recordTcgdexMatchResult({ ...context, tradingCardId: card.id, result: { ...error, providerCode: "NETWORK_ERROR" } })).resolves.toBeTruthy()
  })

  it("applies only approved fields, protects variant data, and is idempotent", async () => {
    const { card, set } = await cardFixture()
    const token = suffix()
    const variant = await service.createTradingCardVariants({ trading_card_id: card.id, condition: "NEAR_MINT", condition_source: "EXPLICIT", finish: "HOLO", finish_confirmed: true, special_treatment: "NONE", special_treatment_confirmed: true, sku: `SKU-${suffix().toUpperCase()}`, origin: "MANUAL", price_locked: false })
    const proposal = await service.recordTcgdexMatchResult({ ...context, tradingCardId: card.id, result: matched(`${token}-enriched`) })
    await service.approveEnrichmentProposal({ ...context, proposalId: proposal.id })
    await expect(service.applyApprovedEnrichmentProposal({ ...context, proposalId: proposal.id })).resolves.toMatchObject({ review_status: "APPLIED" })
    const applied = await service.retrieveTradingCard(proposal.trading_card_id)
    const savedVariant = await service.retrieveTradingCardVariant(variant.id)
    expect(applied.name).toBe(`${token}-enriched`)
    expect(savedVariant).toMatchObject({ condition: "NEAR_MINT", finish: "HOLO", special_treatment: "NONE", sku: variant.sku, price_locked: false })
    await expect(service.applyApprovedEnrichmentProposal({ ...context, proposalId: proposal.id })).resolves.toMatchObject({ review_status: "APPLIED" })
    expect(await service.listExternalCardReferences({ provider: "TCGDEX", provider_identifier: `SET:sv1-${token}-enriched` })).toHaveLength(1)
    expect(set.id).toBe(applied.card_set_id)
  })

  it("normalises rarity_comparison with the shared Stage 3 rule, matching Stage 3 creation for the same raw value", async () => {
    const token = suffix()
    // Surrounding whitespace plus a decomposed-Unicode "e" + combining acute
    // accent, exactly like the existing rarityComparisonForm unit coverage —
    // proves trimming, Unicode NFC normalisation, and case preservation all
    // survive the enrichment-application write path, not just the helper
    // itself in isolation.
    const rawRarityValue = "  Illustratión  "
    const expectedComparison = rarityComparisonForm(rawRarityValue)
    expect(expectedComparison).toBe("Illustratión")

    const stage3Set = await service.createCardSets({ game: "POKEMON", language: "EN", display_name: `Set ${token}`, provider_set_code: `set3-${token}` })
    const stage3Card = await service.createTradingCards({
      card_set_id: stage3Set.id, name: `Stage3 ${token}`, search_name: `stage3 ${token}`,
      card_number: "001", card_number_normalised: "001", origin: "MANUAL",
      rarity: "ILLUSTRATION_RARE", rarity_icon_key: "illustration-rare",
      rarity_raw: rawRarityValue, rarity_comparison: rarityComparisonForm(rawRarityValue),
    })
    expect(stage3Card.rarity_comparison).toBe(expectedComparison)

    const { card: enrichedCard } = await cardFixture()
    const proposal = await service.recordTcgdexMatchResult({
      ...context, tradingCardId: enrichedCard.id,
      result: matchedWithRarity(`${token}-mapped`, rawRarityValue, "ILLUSTRATION_RARE", "illustration-rare"),
    })
    await service.approveEnrichmentProposal({ ...context, proposalId: proposal.id })
    await service.applyApprovedEnrichmentProposal({ ...context, proposalId: proposal.id })
    const applied = await service.retrieveTradingCard(enrichedCard.id)

    expect(applied.rarity).toBe("ILLUSTRATION_RARE")
    expect(applied.rarity_icon_key).toBe("illustration-rare")
    expect(applied.rarity_comparison).toBe(expectedComparison)
    expect(applied.rarity_comparison).toBe(stage3Card.rarity_comparison)
  })

  it("leaves all local rarity fields unchanged when the mapped rarity candidate is unmapped", async () => {
    const { card } = await cardFixture()
    const token = suffix()
    const before = await service.retrieveTradingCard(card.id)
    const proposal = await service.recordTcgdexMatchResult({ ...context, tradingCardId: card.id, result: matched(`${token}-unmapped`, "UNMAPPED") })
    await service.approveEnrichmentProposal({ ...context, proposalId: proposal.id })
    await service.applyApprovedEnrichmentProposal({ ...context, proposalId: proposal.id })
    const after = await service.retrieveTradingCard(card.id)
    expect(after.rarity).toBe(before.rarity)
    expect(after.rarity_icon_key).toBe(before.rarity_icon_key)
    expect(after.rarity_raw).toBe(before.rarity_raw)
    expect(after.rarity_comparison).toBe(before.rarity_comparison)
    // The name is still applied independently of the (unmapped) rarity outcome.
    expect(after.name).toBe(`${token}-unmapped`)
  })

  it("commits trusted manual references atomically", async () => {
    const { card, set } = await cardFixture()
    const reference = await service.recordTrustedTcgdexCardReference({ ...context, tradingCardId: card.id, providerIdentifier: `manual-${suffix()}` })
    expect((await service.recordTrustedTcgdexCardReference({ ...context, tradingCardId: card.id, providerIdentifier: reference.provider_identifier })).id).toBe(reference.id)
    const setReference = await service.recordTrustedTcgdexSetReference({ ...context, cardSetId: set.id, providerIdentifier: `set-${suffix()}` })
    expect(setReference.card_set_id).toBe(set.id)
  })

  it("blocks every generated proposal and diagnostic attempt mutation method and leaves reads working", async () => {
    const { card } = await cardFixture()
    const proposal = await service.recordTcgdexMatchResult({ ...context, tradingCardId: card.id, result: matched(`${suffix()}-crud`) })
    const proposalCountBefore = (await service.listTcgDexEnrichmentProposals({ id: proposal.id })).length
    const attempt = await service.recordTcgdexMatchResult({ ...context, tradingCardId: card.id, result: { code: "NO_MATCH", source: "AUTOMATIC", reason: "NOT_FOUND" } })
    const attemptCountBefore = (await service.listTcgDexEnrichmentAttempts({ id: attempt.id })).length

    await expect(service.createTcgDexEnrichmentProposals({})).rejects.toMatchObject({ type: "not_allowed" })
    await expect(service.updateTcgDexEnrichmentProposals({})).rejects.toMatchObject({ type: "not_allowed" })
    await expect(service.deleteTcgDexEnrichmentProposals(proposal.id)).rejects.toMatchObject({ type: "not_allowed" })
    await expect(service.softDeleteTcgDexEnrichmentProposals(proposal.id)).rejects.toMatchObject({ type: "not_allowed" })
    await expect(service.restoreTcgDexEnrichmentProposals(proposal.id)).rejects.toMatchObject({ type: "not_allowed" })
    await expect(service.createTcgDexEnrichmentAttempts({})).rejects.toMatchObject({ type: "not_allowed" })
    await expect(service.updateTcgDexEnrichmentAttempts({})).rejects.toMatchObject({ type: "not_allowed" })
    await expect(service.deleteTcgDexEnrichmentAttempts(attempt.id)).rejects.toMatchObject({ type: "not_allowed" })
    await expect(service.softDeleteTcgDexEnrichmentAttempts(attempt.id)).rejects.toMatchObject({ type: "not_allowed" })
    await expect(service.restoreTcgDexEnrichmentAttempts(attempt.id)).rejects.toMatchObject({ type: "not_allowed" })

    expect((await service.listTcgDexEnrichmentProposals({ id: proposal.id })).length).toBe(proposalCountBefore)
    expect((await service.listTcgDexEnrichmentAttempts({ id: attempt.id })).length).toBe(attemptCountBefore)
    expect((await service.retrieveTcgDexEnrichmentProposal(proposal.id)).id).toBe(proposal.id)
    expect((await service.listTcgDexEnrichmentAttempts({ id: attempt.id }))[0].id).toBe(attempt.id)
  })

  it("serializes concurrent proposals and applications", async () => {
    const { card } = await cardFixture()
    const token = suffix()
    const identical = await Promise.all(Array.from({ length: 4 }, () => service.recordTcgdexMatchResult({ ...context, tradingCardId: card.id, result: matched(`${token}-same`) })))
    expect(new Set(identical.map((value: any) => value.id)).size).toBe(1)
    const different = await Promise.all([
      service.recordTcgdexMatchResult({ ...context, tradingCardId: card.id, result: matched(`${token}-a`) }),
      service.recordTcgdexMatchResult({ ...context, tradingCardId: card.id, result: matched(`${token}-b`) }),
    ])
    const refreshed = await Promise.all(different.map((value: any) => service.retrieveTcgDexEnrichmentProposal(value.id)))
    expect(refreshed.filter((value: any) => value.review_status === "PENDING")).toHaveLength(1)
    const current = refreshed.find((value: any) => value.review_status === "PENDING")
    await service.approveEnrichmentProposal({ ...context, proposalId: current.id })
    const applications = await Promise.all([1, 2, 3].map(() => service.applyApprovedEnrichmentProposal({ ...context, proposalId: current.id })))
    expect(new Set(applications.map((value: any) => value.review_status))).toEqual(new Set(["APPLIED"]))
  })

  it("rolls back canonical application when an automatic reference conflicts", async () => {
    const first = await cardFixture()
    const second = await cardFixture()
    const token = suffix()
    const result = matched(`${token}-conflict`)
    await service.recordTrustedTcgdexCardReference({ ...context, tradingCardId: second.card.id, providerIdentifier: result.enrichment.providerCardId })
    const proposal = await service.recordTcgdexMatchResult({ ...context, tradingCardId: first.card.id, result })
    await service.approveEnrichmentProposal({ ...context, proposalId: proposal.id })
    await expect(service.applyApprovedEnrichmentProposal({ ...context, proposalId: proposal.id })).rejects.toThrow("reference")
    expect((await service.retrieveTradingCard(first.card.id)).name).toBe(first.card.name)
    expect((await service.retrieveTcgDexEnrichmentProposal(proposal.id)).review_status).toBe("APPROVED")
  })

  it("rolls back the entire application when the application audit write fails", async () => {
    const { card } = await cardFixture()
    const token = suffix()
    const before = await service.retrieveTradingCard(card.id)
    const proposal = await service.recordTcgdexMatchResult({ ...context, tradingCardId: card.id, result: matched(`${token}-audit-fail`) })
    await service.approveEnrichmentProposal({ ...context, proposalId: proposal.id })
    const originalWriteAudit = service.writeAudit
    service.writeAudit = async () => { throw new Error("simulated application audit failure") }
    try {
      await expect(service.applyApprovedEnrichmentProposal({ ...context, proposalId: proposal.id })).rejects.toThrow("simulated application audit failure")
    } finally {
      service.writeAudit = originalWriteAudit
    }

    const after = await service.retrieveTradingCard(card.id)
    expect(after.name).toBe(before.name)
    expect(after.search_name).toBe(before.search_name)
    expect(after.rarity).toBe(before.rarity)
    expect(after.rarity_icon_key).toBe(before.rarity_icon_key)
    expect(after.rarity_raw).toBe(before.rarity_raw)
    expect(after.rarity_comparison).toBe(before.rarity_comparison)

    const rolledBackProposal = await service.retrieveTcgDexEnrichmentProposal(proposal.id)
    expect(rolledBackProposal.review_status).toBe("APPROVED")
    expect(rolledBackProposal.applied_at).toBeNull()

    expect(await service.listExternalCardReferences({ provider: "TCGDEX", provider_identifier: `sv1-${token}-audit-fail` })).toHaveLength(0)
    expect(await service.listExternalCardReferences({ provider: "TCGDEX", provider_identifier: `SET:sv1-${token}-audit-fail` })).toHaveLength(0)
  })

  it("rolls back a trusted manual reference when its audit fails", async () => {
    const { card } = await cardFixture()
    const providerIdentifier = `manual-audit-${suffix()}`
    const originalWriteAudit = service.writeAudit
    service.writeAudit = async () => { throw new Error("simulated audit failure") }
    try {
      await expect(service.recordTrustedTcgdexCardReference({ ...context, tradingCardId: card.id, providerIdentifier })).rejects.toThrow("simulated audit failure")
    } finally {
      service.writeAudit = originalWriteAudit
    }
    expect(await service.listExternalCardReferences({ provider: "TCGDEX", provider_identifier: providerIdentifier })).toHaveLength(0)
  })
})
