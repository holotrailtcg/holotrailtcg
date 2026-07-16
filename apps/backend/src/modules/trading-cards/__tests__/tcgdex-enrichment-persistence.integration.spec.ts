import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { asValue } from "@medusajs/framework/awilix"
import { ContainerRegistrationKeys, createPgConnection, Modules } from "@medusajs/framework/utils"
import type { IProductModuleService } from "@medusajs/framework/types"
import { TRADING_CARDS_MODULE } from "../index"
import { Migration20260714150000 } from "../migrations/Migration20260714150000"
import { Migration20260715120000 } from "../migrations/Migration20260715120000"
import { rarityComparisonForm } from "../rarity/normalise-rarity"
import { createTradingCardForProductWorkflow } from "../../../workflows/trading-cards/create-trading-card-for-product"
import "../../../links/trading-card-product"
import "../../../links/trading-card-variant-product-variant"

let pgConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
let service: any
const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`

beforeAll(async () => {
  pgConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  const migration = new Migration20260714150000(undefined as never, undefined as never)
  await migration.up()
  // Migration20260714150000's up() unconditionally narrows the
  // `trading_card_audit_entry` entity_type/action checks to lists that
  // exclude `CARD_IMAGE`/`IMAGE_*`. If a card-image spec (which widens those
  // same checks, see Migration20260715120000) has ever run against this
  // database and left `CARD_IMAGE` audit rows behind, re-adding that
  // narrower check here fails outright — the existing rows violate it. This
  // spec only actually needs this migration's `trading_card_external_reference`
  // and `trading_card_tcgdex_enrichment_*` schema changes, so its
  // `trading_card_audit_entry` constraint queries are skipped here and
  // superseded by Migration20260715120000's wider checks below, which are a
  // strict superset of what this migration would otherwise add.
  const schemaOnlyQueries = migration.getQueries().map(String).filter((query) => !query.includes(`"trading_card_audit_entry"`))
  for (const query of schemaOnlyQueries) await pgConnection.raw(query)
  migration.reset()

  const imageMigration = new Migration20260715120000(undefined as never, undefined as never)
  await imageMigration.up()
  for (const query of imageMigration.getQueries()) await pgConnection.raw(String(query))
  imageMigration.reset()

  medusaApp = await MedusaApp({ modulesConfig: {
    [TRADING_CARDS_MODULE]: { resolve: "./src/modules/trading-cards", definition: { key: TRADING_CARDS_MODULE, isQueryable: true } },
    [Modules.PRODUCT]: { resolve: "@medusajs/medusa/product" },
  }, injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection }, cwd: process.cwd() })
  await medusaApp.onApplicationStart()
  if (!medusaApp.sharedContainer || !medusaApp.link) throw new Error("Expected Medusa link container")
  medusaApp.sharedContainer.register("link", asValue(medusaApp.link))
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
  const providerName = name.replace(/[^A-Za-z0-9_-]/g, "-")
  return { code: "MATCHED", source: "AUTOMATIC", enrichment: {
    provider: "TCGDEX", providerCardId: `sv1-${providerName}`, providerSetId: `sv1-${providerName}`, name, localId: "001", category: "Pokemon",
    providerRarity: providerValue, rarityCandidate: { status: "MAPPED", providerValue, rarity, iconKey },
    variants: { normal: true, reverse: false, holo: false, firstEdition: false },
  } } as const
}

function matchedNameOnly(name: string) {
  const providerName = name.replace(/[^A-Za-z0-9_-]/g, "-")
  return { code: "MATCHED", source: "AUTOMATIC", enrichment: {
    provider: "TCGDEX", providerCardId: `sv1-${providerName}`, providerSetId: `sv1-${providerName}`, name, localId: "001", category: "Pokemon",
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

  it("matches rarity comparison between the real Stage 3 workflow and Stage 4A.3", async () => {
    const token = suffix()
    const rawRarityValue = "  iLluStrat" + "i" + "\u0301" + "n  "
    const expectedComparison = rarityComparisonForm(rawRarityValue)
    expect(rawRarityValue).not.toBe(rawRarityValue.normalize("NFC"))
    expect(expectedComparison).toBe("iLluStratín")

    const container = medusaApp.sharedContainer
    if (!container) throw new Error("Expected Medusa shared container")
    const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
    const product = await products.createProducts({
      title: `Stage 3 parity ${token}`,
      status: "draft",
      variants: [{ title: "Near Mint", manage_inventory: false }],
    })
    expect(product.variants?.[0]).toBeDefined()
    const stage3Set = await service.createCardSets({ game: "POKEMON", language: "EN", display_name: `Set ${token}`, provider_set_code: `set3-${token}` })
    const { result: workflowCard } = await createTradingCardForProductWorkflow(container).run({ input: {
      productId: product.id,
      card: {
        card_set_id: stage3Set.id, name: `Stage3 ${token}`, search_name: `stage3 ${token}`,
        card_number: "001", origin: "MANUAL", rarity: "ILLUSTRATION_RARE",
        rarity_icon_key: "illustration-rare", rarity_raw: rawRarityValue,
      },
    } })
    expect(workflowCard).toBeTruthy()
    const stage3Card = await service.retrieveTradingCard(workflowCard.id)
    expect(stage3Card.rarity_raw).toBe(rawRarityValue)
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
    expect(applied.rarity_raw).toBe(rawRarityValue)
    expect(applied.rarity_comparison).toBe(expectedComparison)
    expect(applied.rarity_comparison).toBe(stage3Card.rarity_comparison)
    expect(stage3Card.rarity_comparison).not.toBe("")
    expect(applied.rarity_comparison).not.toBe("")
    expect(applied.rarity_comparison).toBe(applied.rarity_comparison.trim())
    expect(applied.rarity_comparison).toBe(applied.rarity_comparison.normalize("NFC"))
    expect(applied.rarity_comparison).toBe("iLluStratín")
    expect(applied.rarity_raw).toContain("  ")
    expect(applied.rarity_raw).toContain("i\u0301")
  })

  it("preserves origin for name-only, mapped-rarity-only, and combined enrichment", async () => {
    const nameOnly = await cardFixture()
    const nameProposal = await service.recordTcgdexMatchResult({ ...context, tradingCardId: nameOnly.card.id, result: matchedNameOnly(`${suffix()}-name`) })
    await service.approveEnrichmentProposal({ ...context, proposalId: nameProposal.id })
    await service.applyApprovedEnrichmentProposal({ ...context, proposalId: nameProposal.id })
    expect((await service.retrieveTradingCard(nameOnly.card.id)).origin).toBe("MANUAL")

    const rarityOnly = await cardFixture()
    const rarityValue = " cOmMoN "
    const rarityProposal = await service.recordTcgdexMatchResult({ ...context, tradingCardId: rarityOnly.card.id, result: matchedWithRarity(rarityOnly.card.name, rarityValue, "COMMON", "common") })
    await service.approveEnrichmentProposal({ ...context, proposalId: rarityProposal.id })
    await service.applyApprovedEnrichmentProposal({ ...context, proposalId: rarityProposal.id })
    expect((await service.retrieveTradingCard(rarityOnly.card.id)).origin).toBe("MANUAL")

    const combined = await cardFixture()
    const combinedProposal = await service.recordTcgdexMatchResult({ ...context, tradingCardId: combined.card.id, result: matchedWithRarity(`${suffix()}-combined`, rarityValue, "COMMON", "common") })
    await service.approveEnrichmentProposal({ ...context, proposalId: combinedProposal.id })
    await service.applyApprovedEnrichmentProposal({ ...context, proposalId: combinedProposal.id })
    expect((await service.retrieveTradingCard(combined.card.id)).origin).toBe("MANUAL")
  })

  it("records exact allowlisted audit changes and an empty list for a no-op", async () => {
    const { card } = await cardFixture()
    const providerValue = " cOmMoN "
    const proposal = await service.recordTcgdexMatchResult({ ...context, tradingCardId: card.id, result: matchedWithRarity(card.name, providerValue, "COMMON", "common") })
    await service.approveEnrichmentProposal({ ...context, proposalId: proposal.id })
    await service.applyApprovedEnrichmentProposal({ ...context, proposalId: proposal.id })
    const audit = (await service.listCardAuditEntries({ entity_id: proposal.id })).find((entry: any) => entry.action === "TCGDEX_ENRICHMENT_APPLIED")
    expect(audit.new_value.changedFields).toEqual(["rarity", "rarity_icon_key", "rarity_raw", "rarity_comparison"])
    expect(audit.new_value.changedFields).not.toContain("origin")
    expect(JSON.stringify(audit)).not.toContain("snapshot")

    const noopFixture = await cardFixture()
    const noop = await service.createTradingCards({
      card_set_id: noopFixture.set.id, name: noopFixture.card.name, search_name: noopFixture.card.search_name,
      card_number: "002", card_number_normalised: "002", origin: "MANUAL",
      rarity: "COMMON", rarity_icon_key: "common", rarity_raw: providerValue,
      rarity_comparison: rarityComparisonForm(providerValue),
    })
    const noopProposal = await service.recordTcgdexMatchResult({ ...context, tradingCardId: noop.id, result: matchedWithRarity(noop.name, providerValue, "COMMON", "common") })
    await service.approveEnrichmentProposal({ ...context, proposalId: noopProposal.id })
    await service.applyApprovedEnrichmentProposal({ ...context, proposalId: noopProposal.id })
    const noopAudit = (await service.listCardAuditEntries({ entity_id: noopProposal.id })).find((entry: any) => entry.action === "TCGDEX_ENRICHMENT_APPLIED")
    expect(noopAudit.new_value.changedFields).toEqual([])
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
