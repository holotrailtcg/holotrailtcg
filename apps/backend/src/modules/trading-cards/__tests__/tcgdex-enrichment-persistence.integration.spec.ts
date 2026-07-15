import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../index"
import { Migration20260714150000 } from "../migrations/Migration20260714150000"

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

  it("commits trusted manual references atomically and blocks generic mutation APIs", async () => {
    const { card, set } = await cardFixture()
    const reference = await service.recordTrustedTcgdexCardReference({ ...context, tradingCardId: card.id, providerIdentifier: `manual-${suffix()}` })
    expect((await service.recordTrustedTcgdexCardReference({ ...context, tradingCardId: card.id, providerIdentifier: reference.provider_identifier })).id).toBe(reference.id)
    const setReference = await service.recordTrustedTcgdexSetReference({ ...context, cardSetId: set.id, providerIdentifier: `set-${suffix()}` })
    expect(setReference.card_set_id).toBe(set.id)
    await expect(service.createTcgDexEnrichmentProposals({})).rejects.toThrow("owned by")
    await expect(service.updateTcgDexEnrichmentProposals({})).rejects.toThrow("owned by")
    await expect(service.deleteTcgDexEnrichmentAttempts({})).rejects.toThrow("owned by")
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
