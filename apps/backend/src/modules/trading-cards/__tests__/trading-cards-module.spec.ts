import { MedusaApp } from "@medusajs/framework/modules-sdk"
import { ContainerRegistrationKeys, createPgConnection } from "@medusajs/framework/utils"
import { TRADING_CARDS_MODULE } from "../index"
import { canonicalIdentityKey, variantIdentityKey } from "../identity/identity-key"
import { normaliseCardNumberComparisonForm } from "../identity/card-number"
import { VERIFIED_DUPLICATE_EEVEE_ROWS } from "../__fixtures__/pulse-rows"
import { EXTERNAL_REFERENCE_NOTE_MAX_LENGTH } from "../service"
import { Migration20260715120000 } from "../migrations/Migration20260715120000"

let pgConnection: ReturnType<typeof createPgConnection>
let medusaApp: Awaited<ReturnType<typeof MedusaApp>>
let service: any

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`
const rows = (result: any): any[] => Array.isArray(result) ? result : result.rows

beforeAll(async () => {
  pgConnection = createPgConnection({ clientUrl: process.env.DATABASE_URL as string })
  medusaApp = await MedusaApp({
    modulesConfig: { [TRADING_CARDS_MODULE]: { resolve: "./src/modules/trading-cards" } },
    injectedDependencies: { [ContainerRegistrationKeys.PG_CONNECTION]: pgConnection },
    cwd: process.cwd(),
  })
  await medusaApp.onApplicationStart()
  service = medusaApp.modules[TRADING_CARDS_MODULE]
}, 60000)

afterAll(async () => {
  await (pgConnection as any)?.context?.destroy()
  await pgConnection?.destroy()
  await medusaApp?.onApplicationPrepareShutdown()
  await medusaApp?.onApplicationShutdown()
})

async function createSet(language: "EN" | "JA" | "ZH" = "EN") {
  const id = suffix()
  return service.createCardSets({
    game: "POKEMON", language, display_name: `Test Set ${id}`, provider_set_code: `set_${id}`,
  })
}

async function createCard(language: "EN" | "JA" | "ZH" = "EN", number = "044/072") {
  const set = await createSet(language)
  const id = suffix()
  const card = await service.createTradingCards({
    card_set_id: set.id, name: `Crobat ${id}`, search_name: `crobat ${id}`,
    card_number: number, card_number_normalised: normaliseCardNumberComparisonForm(number), origin: "PULSE",
  })
  return { set, card }
}

async function createVariant(overrides: Record<string, unknown> = {}) {
  const { card } = await createCard()
  const id = suffix()
  const variant = await service.createTradingCardVariants({
    trading_card_id: card.id, condition: "NEAR_MINT", condition_source: "DEFAULTED",
    finish: "HOLO", finish_confirmed: true, special_treatment: "NONE",
    special_treatment_confirmed: true, sku: `POKEMON-EN-TEST-044_072-${id.toUpperCase()}`,
    origin: "PULSE", ...overrides,
  })
  return { card, variant }
}

describe("trading-card schema", () => {
  it("resolves all six model services", () => {
    expect(typeof service.createCardSets).toBe("function")
    expect(typeof service.createTradingCards).toBe("function")
    expect(typeof service.createTradingCardVariants).toBe("function")
    expect(typeof service.createExternalCardReferences).toBe("function")
    expect(typeof service.createCardAuditEntries).toBe("function")
    expect(typeof service.createRarityMappings).toBe("function")
  })

  it("keeps audit entries append-only through the public module service", async () => {
    await expect(service.updateCardAuditEntries()).rejects.toThrow("append-only")
    await expect(service.deleteCardAuditEntries()).rejects.toThrow("cannot be deleted")
    await expect(service.softDeleteCardAuditEntries()).rejects.toThrow("cannot be deleted")
    await expect(service.restoreCardAuditEntries()).rejects.toThrow("cannot be restored")
  })

  it("enforces canonical identity uniqueness within a set", async () => {
    const { set } = await createCard("EN", "0104/15")
    await expect(service.createTradingCards({
      card_set_id: set.id, name: "Duplicate", search_name: "duplicate",
      card_number: "0104/15", card_number_normalised: normaliseCardNumberComparisonForm("0104/15"),
    })).rejects.toThrow()
  })

  it("separates otherwise matching identities by language-specific sets", async () => {
    const en = await createCard("EN", "53/62")
    const ja = await createCard("JA", "53/62")
    expect(en.card.id).not.toBe(ja.card.id)
  })

  // Checkpoint 5B follow-up: an earlier report claimed pre-migration Pulse
  // matching "remains correct because the incoming candidate is
  // normalised", without verifying the actual stored comparison. That claim
  // was FALSE: a literal `card_number_normalised = ?` SQL comparison against
  // only the new (denominator-stripped) form returns zero rows for a row
  // that has not yet been migrated — "044/072" (stored, unmigrated) is never
  // equal to "044" (candidate, normalised). Verified directly by temporarily
  // reverting `findVariantCandidatesForPulseMatch` to the single-form query
  // and re-running this exact test, which failed (0 candidates) before the
  // legacy-fallback branch below was added, and passes now that it exists.
  it("findVariantCandidatesForPulseMatch finds a genuinely unmigrated legacy row via the legacy-fallback branch", async () => {
    const setId = suffix()
    const set = await service.createCardSets({
      game: "POKEMON", language: "EN", display_name: `Legacy Match Set ${setId}`, provider_set_code: `set_legacy_match_${setId}`,
    })
    // Deliberately written with the OLD algorithm's shape — denominator
    // still attached — exactly as every pre-Phase-8 writer would have left
    // it, and exactly what `Migration20260718160000` exists to fix. Never
    // migrated in this test, by design.
    const legacyCard = await service.createTradingCards({
      card_set_id: set.id, name: `Legacy Match Card ${setId}`, search_name: `legacy match card ${setId}`,
      card_number: "044/072", card_number_normalised: "044/072", origin: "PULSE",
    })
    const legacyVariant = await service.createTradingCardVariants({
      trading_card_id: legacyCard.id, condition: "NEAR_MINT", condition_source: "EXPLICIT",
      finish: "HOLO", finish_confirmed: true, special_treatment: "NONE", special_treatment_confirmed: true,
      sku: `SKU-LEGACYMATCH-${setId.toUpperCase()}`, origin: "PULSE",
    })

    // A fresh Pulse row for the exact same physical card — the shape
    // `parseProductId` would hand `findVariantCandidatesForPulseMatch` today.
    const candidates = await service.findVariantCandidatesForPulseMatch({
      setCodeCandidate: `set_legacy_match_${setId}`, cardNumberCandidate: "044/072", language: "EN",
      condition: "NEAR_MINT", finish: "HOLO", specialTreatment: "NONE",
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0].id).toBe(legacyVariant.id)
  })

  it("findVariantCandidatesForPulseMatch finds a legacy row with a lowercase suffix via the legacy-fallback branch", async () => {
    const setId = suffix()
    const set = await service.createCardSets({
      game: "POKEMON", language: "EN", display_name: `Legacy Suffix Set ${setId}`, provider_set_code: `set_legacy_suffix_${setId}`,
    })
    // Old algorithm preserved case — "025a" was never uppercase-folded.
    const legacyCard = await service.createTradingCards({
      card_set_id: set.id, name: `Legacy Suffix Card ${setId}`, search_name: `legacy suffix card ${setId}`,
      card_number: "025a", card_number_normalised: "025a", origin: "PULSE",
    })
    const legacyVariant = await service.createTradingCardVariants({
      trading_card_id: legacyCard.id, condition: "NEAR_MINT", condition_source: "EXPLICIT",
      finish: "HOLO", finish_confirmed: true, special_treatment: "NONE", special_treatment_confirmed: true,
      sku: `SKU-LEGACYSUFFIX-${setId.toUpperCase()}`, origin: "PULSE",
    })

    const candidates = await service.findVariantCandidatesForPulseMatch({
      setCodeCandidate: `set_legacy_suffix_${setId}`, cardNumberCandidate: "025a", language: "EN",
      condition: "NEAR_MINT", finish: "HOLO", specialTreatment: "NONE",
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0].id).toBe(legacyVariant.id)
  })

  it("findVariantCandidatesForPulseMatch finds the same row once it has been migrated to the new normalisation shape", async () => {
    const setId = suffix()
    const set = await service.createCardSets({
      game: "POKEMON", language: "EN", display_name: `Migrated Match Set ${setId}`, provider_set_code: `set_migrated_match_${setId}`,
    })
    // Post-migration shape: denominator stripped, uppercase-folded — what
    // Migration20260718160000 leaves behind.
    const migratedCard = await service.createTradingCards({
      card_set_id: set.id, name: `Migrated Match Card ${setId}`, search_name: `migrated match card ${setId}`,
      card_number: "044/072", card_number_normalised: "044", origin: "PULSE",
    })
    const variant = await service.createTradingCardVariants({
      trading_card_id: migratedCard.id, condition: "NEAR_MINT", condition_source: "EXPLICIT",
      finish: "HOLO", finish_confirmed: true, special_treatment: "NONE", special_treatment_confirmed: true,
      sku: `SKU-MIGRATEDMATCH-${setId.toUpperCase()}`, origin: "PULSE",
    })

    const candidates = await service.findVariantCandidatesForPulseMatch({
      setCodeCandidate: `set_migrated_match_${setId}`, cardNumberCandidate: "044/072", language: "EN",
      condition: "NEAR_MINT", finish: "HOLO", specialTreatment: "NONE",
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0].id).toBe(variant.id)
  })

  it("prevents duplicate commercial variants and duplicate SKUs", async () => {
    const { card, variant } = await createVariant()
    await expect(service.createTradingCardVariants({
      trading_card_id: card.id, condition: variant.condition, condition_source: "EXPLICIT",
      finish: variant.finish, finish_confirmed: true, special_treatment: variant.special_treatment,
      special_treatment_confirmed: true, sku: `UNIQUE-${suffix().toUpperCase()}`,
    })).rejects.toThrow()
    const another = await createCard()
    await expect(service.createTradingCardVariants({
      trading_card_id: another.card.id, condition: "LIGHTLY_PLAYED", condition_source: "EXPLICIT",
      finish: "HOLO", finish_confirmed: true, special_treatment: "NONE",
      special_treatment_confirmed: true, sku: variant.sku,
    })).rejects.toThrow()
  })

  it("enforces SKU charset/length and confirmed Normal", async () => {
    const { card } = await createCard()
    await expect(service.createTradingCardVariants({
      trading_card_id: card.id, condition: "NEAR_MINT", condition_source: "DEFAULTED",
      finish: "NORMAL", finish_confirmed: false, special_treatment: "NONE",
      special_treatment_confirmed: true, sku: "invalid sku",
    })).rejects.toThrow()
  })

  it("stores the high-value tracking flag on the variant without inventory quantity", async () => {
    const { variant } = await createVariant({ is_high_value_track_individually: true })
    expect(variant.is_high_value_track_individually).toBe(true)
    expect(Object.keys(variant)).not.toContain("quantity")
  })
})

describe("rarity and external references", () => {
  it("uses language-specific exact mapping before a global mapping", async () => {
    const token = `Rare ${suffix()}`
    await service.createRarityMappings({
      provider: "PULSE", language: null, raw_value: token, comparison_value: token,
      rarity: "COMMON", icon_key: "common",
    })
    await service.createRarityMappings({
      provider: "PULSE", language: "JA", raw_value: token, comparison_value: token,
      rarity: "UNCOMMON", icon_key: "uncommon",
    })
    expect((await service.normaliseRarity({ provider: "PULSE", language: "JA", rawValue: ` ${token} ` })).rarity).toBe("UNCOMMON")
    expect((await service.normaliseRarity({ provider: "PULSE", language: "EN", rawValue: token })).rarity).toBe("COMMON")
    expect(await service.normaliseRarity({ provider: "PULSE", language: "EN", rawValue: token.toLowerCase() })).toBeNull()
  })

  it("keeps unmapped rarity null and confirmed no-rarity explicit", async () => {
    expect(await service.normaliseRarity({ provider: "PULSE", language: "EN", rawValue: `Unknown ${suffix()}` })).toBeNull()
    const token = `—${suffix()}`
    await service.createRarityMappings({
      provider: "PULSE", language: "ZH", raw_value: token, comparison_value: token,
      rarity: "NO_RARITY", icon_key: "no-rarity",
    })
    expect((await service.normaliseRarity({ provider: "PULSE", language: "ZH", rawValue: token })).rarity).toBe("NO_RARITY")
  })

  it("enforces global provider identifier uniqueness", async () => {
    const first = await createCard()
    const second = await createCard()
    const providerIdentifier = `card:test|${suffix()}`
    await service.createExternalCardReferences({
      trading_card_id: first.card.id, provider: "PULSE", provider_identifier: providerIdentifier,
    })
    await expect(service.createExternalCardReferences({
      trading_card_id: second.card.id, provider: "PULSE", provider_identifier: providerIdentifier,
    })).rejects.toThrow()
  })

  it("uses only trusted manual Pulse references and normalises surrounding whitespace", async () => {
    const { card, variant } = await createVariant()
    const providerIdentifier = `card:test|${suffix()}|Reverse Holo|null|null|null`
    const automatic = await service.upsertExternalReference({
      tradingCardId: card.id, tradingCardVariantId: variant.id, provider: "PULSE",
      providerIdentifier: `  ${providerIdentifier}  `, provenance: "AUTOMATIC",
      actor: "matching-test", source: "PULSE",
    })
    expect(automatic.provider_identifier).toBe(providerIdentifier)
    expect(await service.findTrustedExternalReference("PULSE", providerIdentifier)).toBeNull()

    await service.upsertExternalReference({
      tradingCardId: card.id, tradingCardVariantId: variant.id, provider: "PULSE", providerIdentifier,
      provenance: "TRUSTED_MANUAL", referenceId: automatic.id, expectedVersion: automatic.version,
      actor: "matching-test", source: "MANUAL",
    })
    expect(await service.findTrustedExternalReference("PULSE", ` ${providerIdentifier} `)).toEqual({
      tradingCardId: card.id, tradingCardVariantId: variant.id,
    })
  })

  it("makes equivalent concurrent reference creation idempotent", async () => {
    const { card } = await createCard()
    const providerIdentifier = `card:concurrent|${suffix()}`
    const input = {
      tradingCardId: card.id, provider: "PULSE", providerIdentifier,
      language: "EN", region: "GB", rawPayloadNote: "short diagnostic",
      actor: "concurrency-test", source: "MANUAL",
    }

    const two = await Promise.all([service.upsertExternalReference(input), service.upsertExternalReference(input)])
    expect(new Set(two.map((reference: any) => reference.id)).size).toBe(1)

    const five = await Promise.all(Array.from({ length: 5 }, () => service.upsertExternalReference(input)))
    expect(new Set(five.map((reference: any) => reference.id)).size).toBe(1)
    const references = await service.listExternalCardReferences({ provider: "PULSE", provider_identifier: providerIdentifier })
    expect(references).toHaveLength(1)
    const audits = await service.listCardAuditEntries({ entity_id: references[0].id })
    expect(audits.map((entry: any) => entry.action)).toEqual(["EXTERNAL_REFERENCE_ADDED"])
  })

  it("rejects racing conflicting creates without leaking a unique-constraint error", async () => {
    const first = await createCard()
    const second = await createCard()
    const providerIdentifier = `card:conflict|${suffix()}`
    const base = { provider: "PULSE", providerIdentifier, actor: "concurrency-test", source: "MANUAL" }
    const results = await Promise.allSettled([
      service.upsertExternalReference({ ...base, tradingCardId: first.card.id, region: "GB" }),
      service.upsertExternalReference({ ...base, tradingCardId: second.card.id, region: "JP" }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"])
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult
    expect(rejected.reason.message).toContain("already exists with different data")
    expect(rejected.reason.message).not.toMatch(/unique|constraint|duplicate key/i)

    const references = await service.listExternalCardReferences({ provider: "PULSE", provider_identifier: providerIdentifier })
    expect(references).toHaveLength(1)
    const audits = await service.listCardAuditEntries({ entity_id: references[0].id })
    expect(audits.map((entry: any) => entry.action)).toEqual(["EXTERNAL_REFERENCE_ADDED"])
  })

  it("requires the current reference ID for a genuine update and audits only changed structural fields", async () => {
    const { card, variant } = await createVariant()
    const providerIdentifier = `card:update|${suffix()}`
    const base = { tradingCardId: card.id, provider: "PULSE", providerIdentifier,
      actor: "update-test", source: "MANUAL", rawPayloadNote: "initial private marker" }
    const reference = await service.upsertExternalReference(base)
    const repeated = await service.upsertExternalReference(base)
    expect(repeated.id).toBe(reference.id)

    await expect(service.upsertExternalReference({ ...base, region: "GB" }))
      .rejects.toThrow("reference ID and version are required")
    const updated = await service.upsertExternalReference({
      ...base, referenceId: reference.id, expectedVersion: reference.version, tradingCardVariantId: variant.id,
      region: "GB", rawPayloadNote: "updated private marker",
    })
    expect(updated.region).toBe("GB")
    expect(updated.raw_payload_note).toBe("updated private marker")
    const audits = await service.listCardAuditEntries({ entity_id: reference.id })
    expect(audits.map((entry: any) => entry.action)).toEqual([
      "EXTERNAL_REFERENCE_ADDED", "EXTERNAL_REFERENCE_CHANGED",
    ])
    expect(audits[1].old_value).toEqual({ trading_card_variant_id: null, region: null })
    expect(audits[1].new_value).toEqual({ trading_card_variant_id: variant.id, region: "GB" })
  })

  it("uses the returned row version to reject racing non-equivalent updates", async () => {
    const { card } = await createCard()
    const providerIdentifier = `card:update-race|${suffix()}`
    const base = { tradingCardId: card.id, provider: "PULSE", providerIdentifier,
      actor: "update-race-test", source: "MANUAL" }
    const reference = await service.upsertExternalReference(base)
    const results = await Promise.allSettled([
      service.upsertExternalReference({
        ...base, referenceId: reference.id, expectedVersion: reference.version, region: "GB",
      }),
      service.upsertExternalReference({
        ...base, referenceId: reference.id, expectedVersion: reference.version, region: "JP",
      }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"])
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult
    expect(rejected.reason.message).toBe("External reference changed before this update")
    const references = await service.listExternalCardReferences({ provider_identifier: providerIdentifier })
    expect(["GB", "JP"]).toContain(references[0].region)
    const audits = await service.listCardAuditEntries({ entity_id: reference.id })
    expect(audits.map((entry: any) => entry.action)).toEqual([
      "EXTERNAL_REFERENCE_ADDED", "EXTERNAL_REFERENCE_CHANGED",
    ])
  })

  it("bounds diagnostic notes at 500 characters and excludes them from every audit snapshot", async () => {
    const { card } = await createCard()
    const marker = `SECRET_NOTE_${suffix()}`
    const providerIdentifier = `card:note|${suffix()}`
    const note = marker + "x".repeat(EXTERNAL_REFERENCE_NOTE_MAX_LENGTH - marker.length)
    const base = { tradingCardId: card.id, provider: "PULSE", providerIdentifier,
      actor: "note-test", source: "MANUAL" }
    const reference = await service.upsertExternalReference({ ...base, rawPayloadNote: note })
    expect(reference.raw_payload_note).toBe(note)
    await service.removeExternalReference({ id: reference.id, actor: "note-test", source: "MANUAL" })
    const audits = await service.listCardAuditEntries({ entity_id: reference.id })
    expect(JSON.stringify(audits)).not.toContain(marker)
    expect(audits).toHaveLength(2)

    const oversizedIdentifier = `card:oversized|${suffix()}`
    await expect(service.upsertExternalReference({
      ...base, providerIdentifier: oversizedIdentifier,
      rawPayloadNote: "x".repeat(EXTERNAL_REFERENCE_NOTE_MAX_LENGTH + 1),
    })).rejects.toThrow("at most 500 characters")
    expect(await service.listExternalCardReferences({ provider_identifier: oversizedIdentifier })).toHaveLength(0)
    expect(await service.listCardAuditEntries({ actor: "note-test", entity_id: oversizedIdentifier })).toHaveLength(0)
    await expect(pgConnection.raw(
      `insert into trading_card_external_reference
       (id, trading_card_id, provider, provider_identifier, raw_payload_note)
       values (?, ?, 'PULSE', ?, ?)`,
      [`tcref_${suffix()}`, card.id, `card:db-oversized|${suffix()}`, "x".repeat(EXTERNAL_REFERENCE_NOTE_MAX_LENGTH + 1)]
    )).rejects.toThrow(/note_length|check constraint/i)
  })
})

describe("audited lifecycle", () => {
  it("audits complete persisted lock state and treats repeated lock operations as idempotent", async () => {
    const { variant } = await createVariant()
    const context = { id: variant.id, actor: "test-admin", source: "MANUAL", reason: "test" }
    await service.updateVariantCondition({ ...context, condition: "LIGHTLY_PLAYED", conditionSource: "EXPLICIT" })
    await service.updateVariantFinish({ ...context, finish: "REVERSE_HOLO", confirmed: true })
    await service.updateVariantSpecialTreatment({ ...context, specialTreatment: "POKE_BALL_REVERSE", confirmed: true })
    const locked = await service.lockVariantPrice(context)
    await expect(service.assertPriceNotLocked(variant.id)).rejects.toThrow("price is locked")
    await service.lockVariantPrice(context)
    const unlocked = await service.unlockVariantPrice(context)
    await service.unlockVariantPrice(context)
    await expect(service.assertPriceNotLocked(variant.id)).resolves.toBeUndefined()
    expect(unlocked).toMatchObject({
      price_locked: false, price_locked_at: null, price_locked_actor: null, price_lock_reason: null,
    })
    const audits = await service.listCardAuditEntries({ entity_id: variant.id })
    expect(audits.map((entry: any) => entry.action)).toEqual(expect.arrayContaining([
      "CONDITION_CHANGED", "FINISH_CHANGED", "SPECIAL_TREATMENT_CHANGED", "PRICE_LOCKED", "PRICE_UNLOCKED",
    ]))
    const lockAudit = audits.find((entry: any) => entry.action === "PRICE_LOCKED")
    const unlockAudit = audits.find((entry: any) => entry.action === "PRICE_UNLOCKED")
    expect(lockAudit).toMatchObject({ actor: "test-admin", source: "MANUAL", reason: "test" })
    expect(lockAudit.old_value).toEqual({
      price_locked: false, price_locked_at: null, price_locked_by: null, price_lock_reason: null,
    })
    expect(lockAudit.new_value).toEqual({
      price_locked: true, price_locked_at: locked.price_locked_at.toISOString(),
      price_locked_by: "test-admin", price_lock_reason: "test",
    })
    expect(unlockAudit).toMatchObject({ actor: "test-admin", source: "MANUAL", reason: "test" })
    expect(unlockAudit.old_value).toEqual(lockAudit.new_value)
    expect(unlockAudit.new_value).toEqual({
      price_locked: false, price_locked_at: null, price_locked_by: null, price_lock_reason: null,
    })
    expect(audits.filter((entry: any) => entry.action === "PRICE_LOCKED")).toHaveLength(1)
    expect(audits.filter((entry: any) => entry.action === "PRICE_UNLOCKED")).toHaveLength(1)
  })

  it("rolls back a price-lock mutation when audit creation fails", async () => {
    const { variant } = await createVariant()
    await expect(service.lockVariantPrice({
      id: variant.id, actor: "rollback-test", source: "INVALID", reason: "must rollback",
    })).rejects.toThrow()
    const after = await service.retrieveTradingCardVariant(variant.id)
    expect(after).toMatchObject({
      price_locked: false, price_locked_at: null, price_locked_actor: null, price_lock_reason: null,
    })
    expect(await service.listCardAuditEntries({ entity_id: variant.id })).toHaveLength(0)
  })

  it("rolls back the mutation and audit if a database constraint fails", async () => {
    const { variant } = await createVariant()
    await expect(service.updateVariantFinish({
      id: variant.id, finish: "NORMAL", confirmed: false, actor: "test-admin", source: "MANUAL",
    })).rejects.toThrow()
    const after = await service.retrieveTradingCardVariant(variant.id)
    expect(after.finish).toBe("HOLO")
    expect(await service.listCardAuditEntries({ entity_id: variant.id })).toHaveLength(0)
  })

  it("audits external-reference add, change, and removal", async () => {
    const { card, variant } = await createVariant()
    const providerIdentifier = `card:audit|${suffix()}`
    const base = { tradingCardId: card.id, provider: "PULSE", providerIdentifier,
      actor: "test-admin", source: "MANUAL" }
    const ref = await service.upsertExternalReference(base)
    await service.upsertExternalReference({
      ...base, referenceId: ref.id, expectedVersion: ref.version,
      tradingCardVariantId: variant.id, region: "UK",
    })
    await service.removeExternalReference({ id: ref.id, actor: "test-admin", source: "MANUAL" })
    const audits = await service.listCardAuditEntries({ entity_id: ref.id })
    expect(audits.map((entry: any) => entry.action)).toEqual([
      "EXTERNAL_REFERENCE_ADDED", "EXTERNAL_REFERENCE_CHANGED", "EXTERNAL_REFERENCE_REMOVED",
    ])
  })
})

describe("grouped identity and link guarantees", () => {
  it("rejects a mismatched product hierarchy at the shared service boundary", async () => {
    await expect(service.assertVariantProductHierarchy({
      productVariantProductId: "prod_b", tradingCardProductId: "prod_a",
    })).rejects.toThrow("must belong to the same Medusa product")
    await expect(service.assertVariantProductHierarchy({
      productVariantProductId: "prod_a", tradingCardProductId: null,
    })).rejects.toThrow("not linked to a Medusa product")
    await expect(service.assertVariantProductHierarchy({
      productVariantProductId: "prod_a", tradingCardProductId: "prod_a",
    })).resolves.toBeUndefined()
  })

  it("converges duplicate Pulse rows without representing quantity", () => {
    const keys = VERIFIED_DUPLICATE_EEVEE_ROWS.map((row) => ({
      card: canonicalIdentityKey("tcset_cbb2_scn_zh", row.cardNumber),
      variant: variantIdentityKey({
        tradingCardId: "tcard_eevee", condition: "NEAR_MINT", finish: "HOLO", specialTreatment: "POKE_BALL",
      }),
    }))
    expect(new Set(keys.map((key) => key.card)).size).toBe(1)
    expect(new Set(keys.map((key) => key.variant)).size).toBe(1)
  })

  it.each([
    ["product_product_tradingcards_trading_card", "product_id", "trading_card_id"],
    ["product_product_variant_tradingcards_trading_card_variant", "product_variant_id", "trading_card_variant_id"],
  ])("enforces one active link on each side of %s", async (table, left, right) => {
    const marker = suffix()
    const insert = (leftId: string, rightId: string, id: string) =>
      pgConnection.raw(`insert into ${table} (${left}, ${right}, id) values (?, ?, ?)`, [leftId, rightId, id])
    const leftRace = await Promise.allSettled([
      insert(`left_${marker}`, `right_${marker}_1`, `link_${marker}_1`),
      insert(`left_${marker}`, `right_${marker}_2`, `link_${marker}_2`),
    ])
    expect(leftRace.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"])

    const rightRace = await Promise.allSettled([
      insert(`left_${marker}_3`, `right_${marker}_3`, `link_${marker}_3`),
      insert(`left_${marker}_4`, `right_${marker}_3`, `link_${marker}_4`),
    ])
    expect(rightRace.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"])
    await pgConnection.raw(`delete from ${table} where id like ?`, [`link_${marker}_%`])
  })
})

/**
 * Codex remediation: `create-card-from-inventory-row`'s compensation must
 * never delete a CardSet/TradingCard a concurrent, successfully-resolved
 * request has since reused. These two guarded deletes are what the
 * workflow's compensation callbacks now call instead of the plain
 * `deleteCardSets`/`deleteTradingCards` — a single atomic
 * `delete ... where not exists (...)` statement, so there is no separate
 * "check, then delete" round trip for another request's insert to land in
 * between.
 */
describe("deleteCardSetIfUnreferenced / deleteTradingCardIfUnreferenced (Stage 5B.3 remediation)", () => {
  it("deletes an unreferenced CardSet and reports true", async () => {
    const set = await createSet()
    const deleted = await service.deleteCardSetIfUnreferenced(set.id)
    expect(deleted).toBe(true)
    await expect(service.retrieveCardSet(set.id)).rejects.toThrow()
  })

  it("leaves a CardSet alone and reports false once a TradingCard references it", async () => {
    const { set, card } = await createCard()
    const deleted = await service.deleteCardSetIfUnreferenced(set.id)
    expect(deleted).toBe(false)
    const stillThere = await service.retrieveCardSet(set.id)
    expect(stillThere.id).toBe(set.id)
    // and the TradingCard itself is of course untouched
    const stillHasCard = await service.retrieveTradingCard(card.id)
    expect(stillHasCard.id).toBe(card.id)
  })

  it("deletes an unreferenced TradingCard and reports true", async () => {
    const { card } = await createCard()
    const deleted = await service.deleteTradingCardIfUnreferenced(card.id)
    expect(deleted).toBe(true)
    await expect(service.retrieveTradingCard(card.id)).rejects.toThrow()
  })

  it("leaves a TradingCard alone and reports false once a TradingCardVariant references it", async () => {
    const { card, variant } = await createVariant()
    const deleted = await service.deleteTradingCardIfUnreferenced(card.id)
    expect(deleted).toBe(false)
    const stillThere = await service.retrieveTradingCard(card.id)
    expect(stillThere.id).toBe(card.id)
    const stillHasVariant = await service.retrieveTradingCardVariant(variant.id)
    expect(stillHasVariant.id).toBe(variant.id)
  })
})

describe("card image domain", () => {
  // Stage 4A.3's own migration spec exercises Migration20260714150000's
  // up() in isolation, which unconditionally redefines the shared
  // CK_trading_card_audit_entity_type/CK_trading_card_audit_action checks
  // from its own hardcoded (pre-image) list. When both migration specs run
  // in the same `test:integration:modules` session, that reapplication can
  // land after this file's own audit-widening migration and undo it. Guard
  // against that ordering by re-applying this migration's up() once before
  // any card-image test runs; it is idempotent (verified by
  // card-image-migration.integration.spec.ts) so this is always safe.
  beforeAll(async () => {
    const migration = new Migration20260715120000(undefined as never, undefined as never)
    await migration.up()
    for (const query of migration.getQueries()) await pgConnection.raw(String(query))
    migration.reset()
  })

  const pendingInput = (variantId: string, overrides: Record<string, unknown> = {}) => ({
    tradingCardVariantId: variantId, uploadedBy: "admin_test", originalFilename: "card.jpg",
    declaredMimeType: "image/jpeg", declaredByteSize: 1_048_576,
    actor: "admin_test", source: "MANUAL", ...overrides,
  })

  const fakeSha256 = () => `${suffix()}${suffix()}`.toLowerCase().replace(/[^a-f0-9]/g, "0").padEnd(64, "0").slice(0, 64)

  async function createReadyImage(variantId: string, sortOrder: number) {
    const pending = await service.createPendingCardImage(pendingInput(variantId))
    await pgConnection.raw(
      `update trading_card_image
       set status = 'READY', sort_order = ?, staging_object_key = null,
           final_object_key = ?, confirmed_mime_type = 'image/jpeg', confirmed_byte_size = 1048576,
           width = 800, height = 1120, sha256_hash = ?
       where id = ?`,
      [sortOrder, `card-images/${variantId}/${pending.id}/${suffix()}.jpg`, fakeSha256(), pending.id]
    )
    return service.retrieveCardImage(pending.id)
  }

  it("belongs to the exact trading-card variant it depicts", async () => {
    const { variant } = await createVariant()
    const image = await service.createPendingCardImage(pendingInput(variant.id))
    expect(image.trading_card_variant_id).toBe(variant.id)
    expect(image.status).toBe("PENDING")
    expect(image.staging_object_key).toContain(`card-images/${variant.id}/`)
    expect(image.final_object_key).toBeNull()
    expect(image.focal_x).toBe(0.5)
    expect(image.focal_y).toBe(0.5)
  })

  it("rejects cross-variant and cross-card ownership mismatches", async () => {
    await expect(service.assertCardImageVariantOwnership({
      imageVariantId: "tcvar_a", expectedVariantId: "tcvar_b",
    })).rejects.toThrow("expected trading-card variant")
    await expect(service.assertCardImageVariantOwnership({
      imageVariantId: "tcvar_a", expectedVariantId: "tcvar_a",
    })).resolves.toBeUndefined()
  })

  it("remains reusable after unrelated stock/state changes elsewhere", async () => {
    const { variant } = await createVariant()
    const image = await createReadyImage(variant.id, 0)
    // Simulate an unrelated stock/state change on the variant itself; the
    // image row is untouched by it and stays listed for the variant.
    await service.updateVariantCondition({
      id: variant.id, condition: "DAMAGED", conditionSource: "EXPLICIT", actor: "t", source: "MANUAL",
    })
    const images = await service.listCardImagesForVariant({ tradingCardVariantId: variant.id })
    expect(images.map((row: any) => row.id)).toContain(image.id)
  })

  it("enforces contiguous, unique sort order among ready images with sort order zero primary", async () => {
    const { variant } = await createVariant()
    const first = await createReadyImage(variant.id, 0)
    const second = await createReadyImage(variant.id, 1)
    const images = await service.listCardImagesForVariant({ tradingCardVariantId: variant.id })
    expect(images.map((row: any) => row.id)).toEqual([first.id, second.id])
    expect(images[0].sort_order).toBe(0)
  })

  it("rejects a duplicate ready sort order at the database boundary", async () => {
    const { variant } = await createVariant()
    await createReadyImage(variant.id, 0)
    const pending = await service.createPendingCardImage(pendingInput(variant.id))
    await expect(pgConnection.raw(
      `update trading_card_image
       set status = 'READY', sort_order = 0, staging_object_key = null,
           final_object_key = ?, confirmed_mime_type = 'image/jpeg', confirmed_byte_size = 1048576,
           width = 800, height = 1120, sha256_hash = ?
       where id = ?`,
      [`card-images/${variant.id}/${pending.id}/${suffix()}.jpg`, fakeSha256(), pending.id]
    )).rejects.toThrow(/IDX_trading_card_image_ready_sort_order|duplicate key/i)
  })

  it("bounds focal values between 0 and 1 at the database boundary", async () => {
    const { variant } = await createVariant()
    const image = await service.createPendingCardImage(pendingInput(variant.id))
    await expect(pgConnection.raw(
      `update trading_card_image set focal_x = 1.5 where id = ?`, [image.id]
    )).rejects.toThrow(/CK_trading_card_image_focal_bounds|check constraint/i)
    await expect(pgConnection.raw(
      `update trading_card_image set focal_y = -0.1 where id = ?`, [image.id]
    )).rejects.toThrow(/CK_trading_card_image_focal_bounds|check constraint/i)
  })

  it("reorders exactly the current ready set and rejects a partial or foreign list", async () => {
    const { variant } = await createVariant()
    const first = await createReadyImage(variant.id, 0)
    const second = await createReadyImage(variant.id, 1)
    const third = await createReadyImage(variant.id, 2)

    await expect(service.reorderReadyCardImages({
      tradingCardVariantId: variant.id, orderedImageIds: [first.id, second.id], actor: "t", source: "MANUAL",
    })).rejects.toThrow("exactly the current ready images")
    await expect(service.reorderReadyCardImages({
      tradingCardVariantId: variant.id, orderedImageIds: [first.id, second.id, "tcimg_not_real"], actor: "t", source: "MANUAL",
    })).rejects.toThrow("exactly the current ready images")

    const reordered = await service.reorderReadyCardImages({
      tradingCardVariantId: variant.id, orderedImageIds: [third.id, first.id, second.id], actor: "t", source: "MANUAL",
    })
    expect(reordered.map((row: any) => row.id)).toEqual([third.id, first.id, second.id])
    expect(reordered.map((row: any) => row.sort_order)).toEqual([0, 1, 2])

    const audits = await service.listCardAuditEntries({ entity_id: variant.id, action: "IMAGE_REORDERED" })
    expect(audits).toHaveLength(1)
    expect(audits[0].new_value).toEqual({ order: [third.id, first.id, second.id] })
  })

  it("archives a ready image, excludes it from active results, and compacts remaining order", async () => {
    const { variant } = await createVariant()
    const first = await createReadyImage(variant.id, 0)
    const second = await createReadyImage(variant.id, 1)

    const archived = await service.archiveCardImage({
      id: first.id, adminId: "admin_archiver", actor: "admin_archiver", source: "MANUAL",
    })
    expect(archived.status).toBe("ARCHIVED")
    expect(archived.archived_by).toBe("admin_archiver")
    expect(archived.archived_at).not.toBeNull()

    const active = await service.listCardImagesForVariant({ tradingCardVariantId: variant.id })
    expect(active.map((row: any) => row.id)).toEqual([second.id])
    expect(active[0].sort_order).toBe(0)

    const withArchived = await service.listCardImagesForVariant({ tradingCardVariantId: variant.id, includeArchived: true })
    expect(withArchived.map((row: any) => row.id).sort()).toEqual([first.id, second.id].sort())
  })

  it("is idempotent when archiving an already-archived image and rejects archiving a non-ready image", async () => {
    const { variant } = await createVariant()
    const image = await createReadyImage(variant.id, 0)
    const context = { adminId: "admin_test", actor: "admin_test", source: "MANUAL" }
    const first = await service.archiveCardImage({ id: image.id, ...context })
    const second = await service.archiveCardImage({ id: image.id, ...context })
    expect(second.status).toBe("ARCHIVED")
    expect(second.archived_at).toEqual(first.archived_at)

    const pending = await service.createPendingCardImage(pendingInput(variant.id))
    await expect(service.archiveCardImage({ id: pending.id, ...context })).rejects.toThrow("Only a ready image can be archived")
  })

  it("restores an archived image to the end of the ready order and rejects restoring a non-archived image", async () => {
    const { variant } = await createVariant()
    const first = await createReadyImage(variant.id, 0)
    const second = await createReadyImage(variant.id, 1)
    await service.archiveCardImage({ id: first.id, adminId: "admin_test", actor: "admin_test", source: "MANUAL" })

    const restored = await service.restoreCardImage({ id: first.id, actor: "admin_test", source: "MANUAL" })
    expect(restored.status).toBe("READY")
    expect(restored.archived_at).toBeNull()
    expect(restored.archived_by).toBeNull()
    expect(restored.sort_order).toBe(1)

    const active = await service.listCardImagesForVariant({ tradingCardVariantId: variant.id })
    expect(active.map((row: any) => row.id)).toEqual([second.id, first.id])

    await expect(service.restoreCardImage({
      id: second.id, actor: "admin_test", source: "MANUAL",
    })).rejects.toThrow("Only an archived image can be restored")
  })

  it("never automatically deletes or purges a card image", async () => {
    const { variant } = await createVariant()
    const image = await createReadyImage(variant.id, 0)
    await service.archiveCardImage({ id: image.id, adminId: "admin_test", actor: "admin_test", source: "MANUAL" })
    const row = await service.retrieveCardImage(image.id)
    expect(row.deleted_at).toBeNull()
  })

  it("records safe, bounded audit data for image lifecycle events", async () => {
    const { variant } = await createVariant()
    const image = await service.createPendingCardImage(pendingInput(variant.id))
    const audits = await service.listCardAuditEntries({ entity_id: image.id })
    expect(audits).toHaveLength(1)
    expect(audits[0].action).toBe("IMAGE_UPLOAD_REQUESTED")
    const serialised = JSON.stringify(audits[0])
    expect(serialised).not.toMatch(/presigned|accessKeyId|secretAccessKey|Authorization/i)
    expect(serialised.length).toBeLessThan(2000)
  })

  it("derives a public URL from a base URL and object key without a stored credential", async () => {
    const url = await service.deriveCardImagePublicUrl({
      publicBaseUrl: "https://images.example.com", objectKey: "card-images/tcvar_1/tcimg_1/abc.jpg",
    })
    expect(url).toBe("https://images.example.com/card-images/tcvar_1/tcimg_1/abc.jpg")
  })

  it("archives the middle image of three and compacts the remainder", async () => {
    const { variant } = await createVariant()
    const first = await createReadyImage(variant.id, 0)
    const second = await createReadyImage(variant.id, 1)
    const third = await createReadyImage(variant.id, 2)

    await service.archiveCardImage({ id: second.id, adminId: "admin_test", actor: "admin_test", source: "MANUAL" })

    const active = await service.listCardImagesForVariant({ tradingCardVariantId: variant.id })
    expect(active.map((row: any) => row.id)).toEqual([first.id, third.id])
    expect(active.map((row: any) => row.sort_order)).toEqual([0, 1])
  })

  describe("generic CardImage mutations are blocked", () => {
    it("rejects createCardImages, updateCardImages, deleteCardImages, softDeleteCardImages, restoreCardImages with NOT_ALLOWED", async () => {
      await expect(service.createCardImages()).rejects.toMatchObject({ type: "not_allowed" })
      await expect(service.updateCardImages()).rejects.toMatchObject({ type: "not_allowed" })
      await expect(service.deleteCardImages()).rejects.toMatchObject({ type: "not_allowed" })
      await expect(service.softDeleteCardImages()).rejects.toMatchObject({ type: "not_allowed" })
      await expect(service.restoreCardImages()).rejects.toMatchObject({ type: "not_allowed" })
    })

    it("leaves the trading_card_image table untouched by blocked create/update/delete attempts", async () => {
      const { variant } = await createVariant()
      const image = await createReadyImage(variant.id, 0)
      const before = rows(await pgConnection.raw(`select * from trading_card_image where id = ?`, [image.id]))[0]
      const beforeCount = rows(await pgConnection.raw(`select count(*)::int as count from trading_card_image`))[0].count

      await expect(service.createCardImages({
        trading_card_variant_id: variant.id, status: "READY",
      })).rejects.toThrow()
      await expect(service.updateCardImages({ id: image.id, sort_order: 99 })).rejects.toThrow()
      await expect(service.deleteCardImages(image.id)).rejects.toThrow()
      await expect(service.softDeleteCardImages(image.id)).rejects.toThrow()

      const after = rows(await pgConnection.raw(`select * from trading_card_image where id = ?`, [image.id]))[0]
      const afterCount = rows(await pgConnection.raw(`select count(*)::int as count from trading_card_image`))[0].count
      expect(after).toEqual(before)
      expect(afterCount).toBe(beforeCount)
    })

    it("cannot be used to reassign a card image to a different variant", async () => {
      const { variant } = await createVariant()
      const { variant: otherVariant } = await createVariant()
      const image = await createReadyImage(variant.id, 0)

      await expect(service.updateCardImages({
        id: image.id, trading_card_variant_id: otherVariant.id,
      })).rejects.toThrow()

      const row = await service.retrieveCardImage(image.id)
      expect(row.trading_card_variant_id).toBe(variant.id)
    })
  })

  describe("assertCardImageVariantOwnership with real persisted data", () => {
    it("accepts same-variant access and rejects both a sibling variant and a variant under a different card", async () => {
      const { card: cardA } = await createCard()
      const variantA1Id = suffix()
      const variantA1 = await service.createTradingCardVariants({
        trading_card_id: cardA.id, condition: "NEAR_MINT", condition_source: "DEFAULTED",
        finish: "HOLO", finish_confirmed: true, special_treatment: "NONE", special_treatment_confirmed: true,
        sku: `OWN-A1-${variantA1Id.toUpperCase()}`, origin: "PULSE",
      })
      const variantA2Id = suffix()
      const variantA2 = await service.createTradingCardVariants({
        trading_card_id: cardA.id, condition: "LIGHTLY_PLAYED", condition_source: "DEFAULTED",
        finish: "HOLO", finish_confirmed: true, special_treatment: "NONE", special_treatment_confirmed: true,
        sku: `OWN-A2-${variantA2Id.toUpperCase()}`, origin: "PULSE",
      })
      const { card: cardB } = await createCard()
      const variantBId = suffix()
      const variantB = await service.createTradingCardVariants({
        trading_card_id: cardB.id, condition: "NEAR_MINT", condition_source: "DEFAULTED",
        finish: "HOLO", finish_confirmed: true, special_treatment: "NONE", special_treatment_confirmed: true,
        sku: `OWN-B-${variantBId.toUpperCase()}`, origin: "PULSE",
      })

      const image = await service.createPendingCardImage(pendingInput(variantA1.id))

      await expect(service.assertCardImageVariantOwnership({
        imageVariantId: image.trading_card_variant_id, expectedVariantId: variantA1.id,
      })).resolves.toBeUndefined()

      await expect(service.assertCardImageVariantOwnership({
        imageVariantId: image.trading_card_variant_id, expectedVariantId: variantA2.id,
      })).rejects.toThrow("expected trading-card variant")

      await expect(service.assertCardImageVariantOwnership({
        imageVariantId: image.trading_card_variant_id, expectedVariantId: variantB.id,
      })).rejects.toThrow("expected trading-card variant")
    })
  })

  describe("contiguity under concurrency", () => {
    async function readyOrders(variantId: string) {
      const active = await service.listCardImagesForVariant({ tradingCardVariantId: variantId })
      return active.map((row: any) => row.sort_order as number)
    }

    function expectContiguous(orders: number[], expectedLength: number) {
      expect(orders).toHaveLength(expectedLength)
      expect([...orders].sort((a, b) => a - b)).toEqual(Array.from({ length: expectedLength }, (_, i) => i))
    }

    it("keeps ready sort order contiguous under two concurrent full reorders of the same variant", async () => {
      const { variant } = await createVariant()
      const first = await createReadyImage(variant.id, 0)
      const second = await createReadyImage(variant.id, 1)
      const third = await createReadyImage(variant.id, 2)
      const ids = [first.id, second.id, third.id]

      await Promise.allSettled([
        service.reorderReadyCardImages({
          tradingCardVariantId: variant.id, orderedImageIds: [third.id, first.id, second.id], actor: "t", source: "MANUAL",
        }),
        service.reorderReadyCardImages({
          tradingCardVariantId: variant.id, orderedImageIds: [second.id, third.id, first.id], actor: "t", source: "MANUAL",
        }),
      ])

      const orders = await readyOrders(variant.id)
      expectContiguous(orders, 3)
      const active = await service.listCardImagesForVariant({ tradingCardVariantId: variant.id })
      expect(active.map((row: any) => row.id).sort()).toEqual([...ids].sort())
    })

    it("keeps ready sort order contiguous when a reorder races an archive on the same variant", async () => {
      const { variant } = await createVariant()
      const first = await createReadyImage(variant.id, 0)
      const second = await createReadyImage(variant.id, 1)
      const third = await createReadyImage(variant.id, 2)

      await Promise.allSettled([
        service.reorderReadyCardImages({
          tradingCardVariantId: variant.id, orderedImageIds: [third.id, first.id, second.id], actor: "t", source: "MANUAL",
        }),
        service.archiveCardImage({ id: second.id, adminId: "admin_test", actor: "admin_test", source: "MANUAL" }),
      ])

      const orders = await readyOrders(variant.id)
      expect(orders.length === 2 || orders.length === 3).toBe(true)
      expectContiguous(orders, orders.length)
    })

    it("keeps ready sort order contiguous when a restore races a reorder on the same variant", async () => {
      const { variant } = await createVariant()
      const first = await createReadyImage(variant.id, 0)
      const second = await createReadyImage(variant.id, 1)
      await service.archiveCardImage({ id: first.id, adminId: "admin_test", actor: "admin_test", source: "MANUAL" })

      await Promise.allSettled([
        service.restoreCardImage({ id: first.id, actor: "admin_test", source: "MANUAL" }),
        service.reorderReadyCardImages({
          tradingCardVariantId: variant.id, orderedImageIds: [second.id], actor: "t", source: "MANUAL",
        }),
      ])

      const orders = await readyOrders(variant.id)
      expect(orders.length === 1 || orders.length === 2).toBe(true)
      expectContiguous(orders, orders.length)
    })

    it("assigns distinct contiguous sort orders to two concurrent restores on the same variant", async () => {
      const { variant } = await createVariant()
      const first = await createReadyImage(variant.id, 0)
      const second = await createReadyImage(variant.id, 1)
      await service.archiveCardImage({ id: first.id, adminId: "admin_test", actor: "admin_test", source: "MANUAL" })
      await service.archiveCardImage({ id: second.id, adminId: "admin_test", actor: "admin_test", source: "MANUAL" })

      const results = await Promise.all([
        service.restoreCardImage({ id: first.id, actor: "admin_test", source: "MANUAL" }),
        service.restoreCardImage({ id: second.id, actor: "admin_test", source: "MANUAL" }),
      ])

      const orders = results.map((row: any) => row.sort_order as number)
      expect(new Set(orders).size).toBe(2)
      const activeOrders = await readyOrders(variant.id)
      expectContiguous(activeOrders, 2)
    })
  })
})
